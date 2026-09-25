import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
try: import road_markings as markings
except ModuleNotFoundError: markings=None
from shapely.geometry import LineString,Polygon,box
from shapely.ops import unary_union

class MarkingsTest(unittest.TestCase):
 def setUp(self):self.assertIsNotNone(markings,'road_markings module required')
 def test_evidence_policy(self):
  self.assertEqual(markings.marking_policy({'crossing':'traffic_signals'})['status'],'unknown')
  self.assertFalse(markings.marking_policy({'crossing':'unmarked','crossing:markings':'yes'})['render'])
  self.assertFalse(markings.marking_policy({'crossing:markings':'no'})['render'])
  self.assertFalse(markings.marking_policy({'crossing:markings':'lines'})['render'])
  p=markings.marking_policy({'crossing:markings':'yes'});self.assertTrue(p['render']);self.assertEqual(p['patternStatus'],'estimated')
 def test_nodes_do_not_restart_spacing(self):
  a=markings.stripe_candidates(LineString([(0,0),(10,0)]))
  b=markings.stripe_candidates(LineString([(0,0),(2.3,0),(2.3,0),(6.1,0),(10,0)]))
  self.assertEqual(len(a),len(b))
  for x,y in zip(a,b):self.assertLess(x['geometry'].symmetric_difference(y['geometry']).area,1e-9)
 def test_tiles_and_holes(self):
  road=Polygon([(-1,-3),(12,-3),(12,3),(-1,3)],holes=[[(4,-.3),(6,-.3),(6,.3),(4,.3)]])
  line=LineString([(0,0),(5,0),(10,1)]);whole=markings.clip_stripes('test',line,road,box(-1,-3,12,3))
  left=markings.clip_stripes('test',line,road,box(-1,-3,5.35,3));right=markings.clip_stripes('test',line,road,box(5.35,-3,12,3))
  joined=unary_union([x['geometry']for x in left+right]);expected=unary_union([x['geometry']for x in whole])
  self.assertLess(joined.symmetric_difference(expected).area,1e-8)
  self.assertLess(joined.difference(road).area,1e-8)
  for x in left:self.assertLessEqual(x['geometry'].bounds[2],5.35+1e-8)
 def test_degenerate_path(self):
  self.assertEqual(markings.stripe_candidates(LineString([(1,1),(1,1)])),[])

if __name__=='__main__':unittest.main()
