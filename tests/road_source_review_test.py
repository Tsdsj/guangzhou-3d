import sys,unittest,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
try:from road_source_review import classify_endpoint,merge_network
except ModuleNotFoundError:classify_endpoint=merge_network=None

class ReviewTest(unittest.TestCase):
 def setUp(self):self.assertIsNotNone(classify_endpoint,'source review functions required')
 def test_identity_is_required_for_connection(self):
  n={'type':'node','id':1,'lat':1,'lon':2};w={'id':10,'nodes':[1,2],'tags':{'highway':'footway'}}
  x={'id':11,'nodes':[1,3],'tags':{'highway':'footway'}}
  self.assertEqual(classify_endpoint(n,w,[w,x])['status'],'highway-connection')
  self.assertEqual(classify_endpoint(n,w,[w,{**x,'nodes':[4,5]}])['status'],'unresolved')
 def test_building_boundary_and_terminal_are_not_missing_roads(self):
  w={'id':10,'nodes':[1,2]};n={'id':1,'tags':{}}
  self.assertEqual(classify_endpoint(n,w,[{'id':20,'nodes':[1,3,4,1],'tags':{'building':'yes'}}])['status'],'building-interface')
  self.assertEqual(classify_endpoint({**n,'tags':{'entrance':'service'}},w,[])['status'],'tagged-terminal')
  self.assertFalse(classify_endpoint({**n,'tags':{'entrance':'service'}},w,[])['physicalPassabilityVerified'])
 def test_incomplete_or_changed_endpoint_stays_unresolved(self):
  n={'id':1,'tags':{'entrance':'yes'}};w={'id':10,'nodes':[1,2]}
  self.assertEqual(classify_endpoint(n,w,None)['status'],'incomplete-source')
  self.assertEqual(classify_endpoint(n,{**w,'nodes':[3,4]},[])['status'],'endpoint-changed')
 def test_delta_only_adds_objects_to_exact_base(self):
  raw=json.dumps({'elements':[{'type':'node','id':1}]}).encode();sha=hashlib.sha256(raw).hexdigest()
  delta={'baseSha256':sha,'elements':[{'type':'node','id':2},{'type':'way','id':5,'nodes':[1,2]}]}
  self.assertEqual(len(merge_network(raw,delta)['elements']),3)
  with self.assertRaises(ValueError):merge_network(raw,{**delta,'baseSha256':'bad'})
  with self.assertRaises(ValueError):merge_network(raw,{**delta,'elements':[{'type':'node','id':1}]})
  with self.assertRaises(ValueError):merge_network(raw,{**delta,'elements':[{'type':'way','id':5,'nodes':[1,9]}]})

if __name__=='__main__':unittest.main()
