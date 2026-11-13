import copy
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('handover',pathlib.Path(__file__).parents[2]/'deploy/complete-main-pc-handover.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HandoverClaims(unittest.TestCase):
    def setUp(self):
        self.command={'action':'prepare-main-pc-handover','installationId':'main-test','releaseId':'r-accepted','nonce':'nonce'}
        self.config={'installationId':'main-test'}
        self.result={'nonce':'nonce','stage':'applied','retired':True,'devicesPreserved':False}
        self.health={'installationId':'main-test','release':{'releaseId':'r-accepted'},'handover':{'nonce':'nonce','stage':'ready'}}

    def test_matching_live_durable_fence_is_required(self):
        module.validate_claim(self.command,self.config,self.result,self.health)
        for changed in [{'installationId':'another-main'},{'handover':None},{'handover':{'nonce':'old','stage':'ready'}},{'handover':{'nonce':'nonce','stage':'preparing'}},{'release':{'releaseId':'old'}}]:
            with self.assertRaises(ValueError):
                module.validate_claim(self.command,self.config,self.result,{**self.health,**changed})

    def test_acknowledgement_cannot_replace_a_handover_with_plain_cleanup(self):
        for changed in [{'nonce':'other'},{'stage':'waiting'},{'retired':False},{'devicesPreserved':True}]:
            with self.assertRaises(ValueError):
                module.validate_claim(self.command,self.config,{**self.result,**changed},self.health)
        command=copy.copy(self.command)
        command['action']='clear-test-data'
        with self.assertRaises(ValueError):
            module.validate_claim(command,self.config,self.result,self.health)


if __name__=='__main__':
    unittest.main()
