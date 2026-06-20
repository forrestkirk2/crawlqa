class Crawlqa < Formula
  desc "Website health scanner — checks broken links, SEO, accessibility & security. Powered by Ollama."
  homepage "https://github.com/forrestkirk2/crawlqa"
  url "https://registry.npmjs.org/crawlqa/-/crawlqa-1.0.0.tgz"
  sha256 "866985a12eec19877c938ff080d7e6043986df69"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "CrawlQA", shell_output("#{bin}/crawlqa --help 2>&1", 1)
  end
end
