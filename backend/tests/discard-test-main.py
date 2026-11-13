import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('discard', pathlib.Path(__file__).parents[2] / 'deploy/discard-unavailable-test-main.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DiscardGuards(unittest.TestCase):
    def test_explicit_discard_and_unreachable_source_required(self):
        args = ['--confirm', module.CONFIRMATION]
        module.validate_request(args, 'active', False)
        module.validate_request(args, 'awaiting-main', False)
        for invalid, phase, reachable in [([], 'active', False), (['--confirm', 'YES'], 'active', False),
                                          (args, 'active', True), (args, 'preparing', False)]:
            with self.assertRaises(ValueError):
                module.validate_request(invalid, phase, reachable)


if __name__ == '__main__':
    unittest.main()
