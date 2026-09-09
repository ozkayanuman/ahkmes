import { useCallback, useRef } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useQuery } from "@tanstack/react-query";
import { Bold, Italic, List, ListOrdered, Heading2, ImagePlus } from "lucide-react";
import { apiGet } from "../lib/api";
import { Button } from "./ui";

// MES-OPERATOR-HMI-002 karar kaydı: kaydedilen HTML'de ham/kalıcı bir signed
// URL asla saklanmaz (süreli olduğu için bozulur) — sadece stabil
// data-document-id referansı. Her render'da GET /documents/:id/url ile taze
// URL'e çözülür (file-preview.tsx'teki "taze URL iste" ilkesiyle tutarlı).
function ResolvedImage({ node }: NodeViewProps) {
  const documentId = node.attrs["data-document-id"] as string | null;
  const alt = (node.attrs.alt as string | null) ?? "";
  const url = useQuery({
    queryKey: ["/documents", documentId, "url"],
    queryFn: () => apiGet<{ url: string }>(`/documents/${documentId}/url`),
    enabled: !!documentId,
    staleTime: 4 * 60 * 1000,
  });

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle">
      {url.data?.url ? (
        <img src={url.data.url} alt={alt} className="max-h-64 rounded border border-slate-200" />
      ) : (
        <span className="text-xs text-slate-400">Resim yükleniyor…</span>
      )}
    </NodeViewWrapper>
  );
}

const DocumentImage = Image.extend({
  addAttributes() {
    return {
      "data-document-id": { default: null },
      alt: { default: null },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResolvedImage);
  },
  renderHTML({ HTMLAttributes }) {
    // src hiçbir zaman üretilmez/saklanmaz — sanitize-html de zaten soyar (bkz.
    // recipe-instruction-sanitizer.ts), burada da hiç üretilmiyor.
    return ["img", { "data-document-id": HTMLAttributes["data-document-id"], alt: HTMLAttributes.alt }];
  },
});

interface Props {
  content: string;
  onChange: (html: string) => void;
  onUploadImage?: (file: File) => Promise<{ id: string }>;
  readOnly?: boolean;
}

/** Paylaşılan WYSIWYG editör — RecipeStep iş talimatı için PLANNER tarafında
 * düzenleme, HMI tarafında salt-okunur gösterim (readOnly) amacıyla kullanılır. */
export function InstructionEditor({ content, onChange, onUploadImage, readOnly }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [StarterKit, DocumentImage],
    content,
    editable: !readOnly,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  const insertImage = useCallback(
    async (file: File) => {
      if (!editor || !onUploadImage) return;
      const doc = await onUploadImage(file);
      editor.chain().focus().insertContent({ type: "image", attrs: { "data-document-id": doc.id, alt: file.name } }).run();
    },
    [editor, onUploadImage],
  );

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-slate-200">
      {!readOnly && (
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 p-1">
          <Button variant="ghost" className="px-2 py-1" onClick={() => editor.chain().focus().toggleBold().run()} title="Kalın">
            <Bold className="h-4 w-4" />
          </Button>
          <Button variant="ghost" className="px-2 py-1" onClick={() => editor.chain().focus().toggleItalic().run()} title="İtalik">
            <Italic className="h-4 w-4" />
          </Button>
          <Button variant="ghost" className="px-2 py-1" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Başlık">
            <Heading2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" className="px-2 py-1" onClick={() => editor.chain().focus().toggleBulletList().run()} title="Madde listesi">
            <List className="h-4 w-4" />
          </Button>
          <Button variant="ghost" className="px-2 py-1" onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numaralı liste">
            <ListOrdered className="h-4 w-4" />
          </Button>
          {onUploadImage && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) insertImage(file);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <Button variant="ghost" className="px-2 py-1" onClick={() => fileRef.current?.click()} title="Resim ekle">
                <ImagePlus className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      )}
      <EditorContent editor={editor} className="prose prose-sm max-w-none p-3" />
    </div>
  );
}
