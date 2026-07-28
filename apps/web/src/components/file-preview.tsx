import { lazy, Suspense } from "react";
import { getFileCategory } from "../lib/file-type";

const StepViewer = lazy(() => import("./step-viewer").then((m) => ({ default: m.StepViewer })));

interface Props {
  fileUrl: string | null;
  fileName: string;
  mimeType: string;
  isLoading?: boolean;
}

/** Belge türüne göre doğru önizleyiciyi seçer — STEP dosyaları için three.js/occt-import-js
 * ile tarayıcı içi 3D görüntüleyici (StepViewer) sadece ihtiyaç anında lazy-load edilir. */
export function FilePreview({ fileUrl, fileName, mimeType, isLoading }: Props) {
  if (isLoading || !fileUrl) {
    return <p className="text-sm text-slate-500">Yükleniyor…</p>;
  }

  const category = getFileCategory(mimeType, fileName);

  if (category === "pdf") {
    return <iframe title={fileName} src={fileUrl} className="h-[500px] w-full rounded-lg border border-slate-200" />;
  }

  if (category === "image") {
    return (
      <img
        src={fileUrl}
        alt={fileName}
        className="max-h-[500px] w-full rounded-lg border border-slate-200 object-contain"
      />
    );
  }

  if (category === "step") {
    return (
      <Suspense fallback={<p className="text-sm text-slate-500">3D görüntüleyici yükleniyor…</p>}>
        <StepViewer url={fileUrl} fileName={fileName} />
      </Suspense>
    );
  }

  return <p className="text-sm text-slate-500">Bu dosya türü için önizleme yok.</p>;
}
