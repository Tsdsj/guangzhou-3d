"""Detail road tiles: estimated carriageways yield to mapped sidewalks; coverage is measured, not a bounding span."""
import json, sys, unittest
from pathlib import Path
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union, substring
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'tools/lib'))
from road_layers import classify_way
from city_frame import load_city

load = lambda p: json.loads((ROOT / p).read_text())


class RoadCoverage(unittest.TestCase):
    def setUp(self):
        self.meta, self.proj, *_ = load_city()
        self.tiles = [t for t in load('data/detail/manifest.json')['tiles'] if t['kind'] == 'roads']

    def surface(self):
        polys = []
        for t in self.tiles:
            cx, _, cz = t['position']
            for s in load(t['url'][2:])['samples']['road']['surfaces']:
                polys.append(Polygon([(x + cx, z + cz) for x, z in s['outer']], [[(x + cx, z + cz) for x, z in h] for h in s['holes']]))
        return unary_union(polys)

    def test_surface_yields_to_mapped_sidewalks(self):
        raw = load('data/evidence/huacheng-osm.json')['elements']
        nodes = {e['id']: e for e in raw if e['type'] == 'node'}
        strips = []
        for e in raw:
            t = e.get('tags', {})
            if e['type'] == 'way' and t.get('footway') == 'sidewalk' and classify_way(t)['groundRenderable'] and all(n in nodes for n in e['nodes']):
                line = LineString([self.proj(nodes[n]['lon'], nodes[n]['lat']) for n in e['nodes']])
                if line.length > 5:
                    strips.append(substring(line, 2.05, line.length - 2.05).buffer(0.8, cap_style='flat'))
        overlap = self.surface().intersection(unary_union(strips)).area
        self.assertLess(overlap, 0.5, f'estimated asphalt still covers {overlap:.2f} m² of mapped sidewalk strips')
        for t in self.tiles:
            road = load(t['url'][2:])['samples']['road']
            self.assertIn('mapped sidewalk', road['surfaceRule'])
            self.assertEqual(road['widthStatus'], 'estimated')

    def test_coverage_report_measures_centrelines(self):
        r = load('docs/research/p3-road-coverage/report.json')
        self.assertTrue(500 <= r['huachengCorridorM'] <= 800)
        self.assertLess(r['huachengCorridorM'], r['tileBoundingSpanM'])
        self.assertEqual(set(r['junctionsWithHuachengAvenue']) >= {'华穗路', '华夏路'}, True)
        self.assertEqual(r['specialStructuresInGroundSurface'], [])


if __name__ == '__main__':
    unittest.main()
