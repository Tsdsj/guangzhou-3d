import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
try:from road_layers import classify_way
except ModuleNotFoundError:classify_way=None

class LayersTest(unittest.TestCase):
 def setUp(self):self.assertIsNotNone(classify_way,'shared layer classifier required')
 def test_positive_and_negative_layers_are_not_heights(self):
  for t in [{'layer':'1'},{'layer':'-1'},{'level':'-1'},{'level':'0;1'},{'layer':'invalid'}]:
   x=classify_way({'highway':'footway',**t});self.assertFalse(x['groundRenderable']);self.assertIsNone(x['heightM'])
 def test_steps_and_covered_passage_are_distinct(self):
  self.assertEqual(classify_way({'highway':'steps','level':'-1;0'})['kind'],'vertical-transition')
  self.assertEqual(classify_way({'highway':'service','tunnel':'building_passage'})['kind'],'building-passage')
  self.assertEqual(classify_way({'highway':'footway','bridge':'yes'})['kind'],'bridge')
  self.assertEqual(classify_way({'highway':'footway','tunnel':'yes'})['kind'],'tunnel')
 def test_access_and_cover_do_not_imply_underpass(self):
  for tags in [{'highway':'primary','foot':'no'},{'highway':'footway','layer':'0','level':'0'},{'highway':'footway','covered':'yes'}]:self.assertTrue(classify_way(tags)['groundRenderable'])
 def test_known_slope_is_not_flattened(self):
  self.assertFalse(classify_way({'highway':'footway','incline':'up'})['groundRenderable'])
  self.assertTrue(classify_way({'highway':'footway','incline':'0%'})['groundRenderable'])

if __name__=='__main__':unittest.main()
