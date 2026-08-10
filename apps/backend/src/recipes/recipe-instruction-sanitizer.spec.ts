import { sanitizeInstructionHtml } from "./recipe-instruction-sanitizer";

describe("sanitizeInstructionHtml", () => {
  it("keeps the allowed formatting/list/heading/table tags", () => {
    const html = "<h2>Başlık</h2><p><strong>kalın</strong> <em>italik</em> <u>altı çizili</u></p><ul><li>madde</li></ul><ol><li>numaralı</li></ol><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>";
    expect(sanitizeInstructionHtml(html)).toBe(html);
  });

  it("keeps an image referenced only by data-document-id and alt, strips a raw src", () => {
    const html = '<img data-document-id="doc-1" alt="şema" src="http://evil.example/x.png">';
    const result = sanitizeInstructionHtml(html);
    expect(result).toContain('data-document-id="doc-1"');
    expect(result).toContain('alt="şema"');
    expect(result).not.toContain("evil.example");
    expect(result).not.toMatch(/\ssrc=/);
  });

  it("strips script tags entirely, including their content", () => {
    const html = "<p>önce</p><script>alert(document.cookie)</script><p>sonra</p>";
    const result = sanitizeInstructionHtml(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert(document.cookie)");
  });

  it("strips inline event handler attributes", () => {
    const html = '<p onclick="alert(1)">tıkla</p>';
    const result = sanitizeInstructionHtml(html);
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("alert(1)");
  });

  it("strips style attributes and style tags", () => {
    const html = '<style>body{display:none}</style><p style="color:red">metin</p>';
    const result = sanitizeInstructionHtml(html);
    expect(result).not.toContain("<style");
    expect(result).not.toContain("style=");
  });

  it("strips anchor tags (no link support in this MVP)", () => {
    const html = '<a href="javascript:alert(1)">link</a>';
    const result = sanitizeInstructionHtml(html);
    expect(result).not.toContain("<a");
    expect(result).not.toContain("javascript:");
  });

  it("handles empty/undefined input safely", () => {
    expect(sanitizeInstructionHtml("")).toBe("");
  });
});
