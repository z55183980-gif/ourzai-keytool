import base64
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("relay", pathlib.Path(__file__).with_name("relay.py"))
relay = importlib.util.module_from_spec(spec); spec.loader.exec_module(relay)

class AllowedTests(unittest.TestCase):
    def test_only_installer_resources(self):
        for url in ("https://downloads.claude.ai/claude-code-releases/latest", "https://api.github.com/repos/openai/codex/releases/latest", "https://persistent.oaistatic.com/codex-app-prod/ChatGPT-x64.msix"):
            self.assertTrue(relay.allowed(url))
        for url in ("http://downloads.claude.ai/releases/a", "https://127.0.0.1/releases/a", "https://downloads.claude.ai.evil.com/releases/a", "https://user:pass@downloads.claude.ai/releases/a", "https://downloads.claude.ai:444/releases/a", "https://downloads.claude.ai/releases/%2e%2e/private", "https://github.com/other/repo/releases/download/a", "https://claude.ai/api/organizations", "file:///etc/passwd"):
            self.assertFalse(relay.allowed(url), url)
    def test_redirect_validation(self):
        req = relay.urllib.request.Request("https://downloads.claude.ai/releases/test")
        with self.assertRaises(relay.urllib.error.HTTPError):
            relay.Redirects().redirect_request(req, None, 302, "", {}, "http://169.254.169.254/latest/meta-data/")

if __name__ == "__main__": unittest.main()
