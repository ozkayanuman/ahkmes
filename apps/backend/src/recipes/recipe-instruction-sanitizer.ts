import sanitizeHtml from "sanitize-html";

// MES-OPERATOR-HMI-002 karar kaydı (docs/mes-operator-hmi-002-work-instruction-decisions.md
// §2): resim src'si asla saklanmaz — sadece stabil data-document-id referansı.
// Bağlantı (<a>), script, style ve inline event handler bu MVP'de tamamen yasak.
const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "ul", "ol", "li", "h1", "h2", "h3", "img", "table", "thead", "tbody", "tr", "td", "th"];

const ALLOWED_ATTRIBUTES = {
  img: ["data-document-id", "alt"],
};

export function sanitizeInstructionHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // img her zaman kendi kendine kapanan bir etiket olarak kalsın (data-document-id
    // dışında hiçbir attribute barınmasın), src her koşulda soyulur (allowlist'te yok).
    allowedSchemesByTag: {},
    disallowedTagsMode: "discard",
  });
}
