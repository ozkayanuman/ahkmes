import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Button } from "./ui";

interface Props {
  url: string;
  fileName: string;
}

interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  meshes: THREE.Mesh[];
  animationId: number;
}

function frameCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls, meshes: THREE.Mesh[]) {
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  camera.position.set(center.x + maxDim, center.y + maxDim, center.z + maxDim);
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}

function StepViewerInner({ url, fileName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [wireframe, setWireframe] = useState(false);
  const [dark, setDark] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanupResize: (() => void) | undefined;

    async function load() {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setClearColor(0xf5f5f5, 1);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
        const controls = new OrbitControls(camera, renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(1, 1, 1);
        scene.add(dirLight);

        const occtimportjs = (await import("occt-import-js")).default;
        const occt = await occtimportjs({ locateFile: (path: string) => `/${path}` });

        const response = await fetch(url);
        const buffer = new Uint8Array(await response.arrayBuffer());
        const result = occt.ReadStepFile(buffer, null);

        if (cancelled) return;
        if (!result.success || result.meshes.length === 0) {
          setStatus("error");
          setErrorMessage("Bu STEP dosyasından okunabilir bir 3D model bulunamadı.");
          return;
        }

        const meshes: THREE.Mesh[] = [];
        for (const rawMesh of result.meshes) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(rawMesh.attributes.position.array, 3));
          if (rawMesh.attributes.normal) {
            geometry.setAttribute("normal", new THREE.Float32BufferAttribute(rawMesh.attributes.normal.array, 3));
          } else {
            geometry.computeVertexNormals();
          }
          if (rawMesh.index?.array) {
            geometry.setIndex(Array.from(rawMesh.index.array));
          }

          const color = rawMesh.color
            ? new THREE.Color(rawMesh.color[0], rawMesh.color[1], rawMesh.color[2])
            : new THREE.Color(0x8896a8);
          const material = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 });
          const mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
          meshes.push(mesh);
        }

        frameCamera(camera, controls, meshes);

        function resize() {
          const el = containerRef.current;
          if (!el) return;
          const width = el.clientWidth;
          const height = el.clientHeight;
          renderer.setSize(width, height, false);
          camera.aspect = width / Math.max(height, 1);
          camera.updateProjectionMatrix();
        }
        resize();
        window.addEventListener("resize", resize);
        cleanupResize = () => window.removeEventListener("resize", resize);

        const handle: SceneHandle = { renderer, scene, camera, controls, meshes, animationId: 0 };
        sceneRef.current = handle;

        function animate() {
          controls.update();
          renderer.render(scene, camera);
          handle.animationId = requestAnimationFrame(animate);
        }
        animate();
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(err instanceof Error ? err.message : "3D model yüklenemedi.");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      cleanupResize?.();
      const handle = sceneRef.current;
      if (handle) {
        cancelAnimationFrame(handle.animationId);
        for (const mesh of handle.meshes) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
        handle.controls.dispose();
        handle.renderer.dispose();
        sceneRef.current = null;
      }
    };
  }, [url]);

  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle) return;
    for (const mesh of handle.meshes) {
      (mesh.material as THREE.MeshStandardMaterial).wireframe = wireframe;
    }
  }, [wireframe]);

  useEffect(() => {
    sceneRef.current?.renderer.setClearColor(dark ? 0x171717 : 0xf5f5f5, 1);
  }, [dark]);

  function resetView() {
    const handle = sceneRef.current;
    if (!handle) return;
    frameCamera(handle.camera, handle.controls, handle.meshes);
  }

  return (
    <div
      ref={containerRef}
      className={`relative h-[500px] w-full overflow-hidden rounded-lg border border-slate-200 ${
        dark ? "bg-neutral-900" : "bg-slate-50"
      } ${fullscreen ? "fixed inset-4 z-50 h-auto" : ""}`}
    >
      <canvas ref={canvasRef} className="h-full w-full" />

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          3D model yükleniyor…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-400">
          {errorMessage} Dosyayı indirip harici bir CAD programında açabilirsiniz.
        </div>
      )}

      {status === "ready" && (
        <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1">
          <Button variant="outline" className="px-2 py-1 text-xs" onClick={() => setWireframe((v) => !v)}>
            {wireframe ? "Katı" : "Tel Kafes"}
          </Button>
          <Button variant="outline" className="px-2 py-1 text-xs" onClick={() => setDark((v) => !v)}>
            {dark ? "Aydınlık Zemin" : "Koyu Zemin"}
          </Button>
          <Button variant="outline" className="px-2 py-1 text-xs" onClick={resetView}>
            Görünümü Sıfırla
          </Button>
          <Button variant="outline" className="px-2 py-1 text-xs" onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? "Küçült" : "Tam Ekran"}
          </Button>
        </div>
      )}
      <p className={`absolute bottom-2 left-2 text-xs ${dark ? "text-slate-300" : "text-slate-500"}`}>{fileName}</p>
    </div>
  );
}

interface BoundaryState {
  hasError: boolean;
}

class StepViewerErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <p className="text-sm text-slate-500">
          3D önizleme yüklenirken bir hata oluştu. Dosyayı indirip harici bir CAD programında açabilirsiniz.
        </p>
      );
    }
    return this.props.children;
  }
}

export function StepViewer(props: Props) {
  return (
    <StepViewerErrorBoundary>
      <StepViewerInner {...props} />
    </StepViewerErrorBoundary>
  );
}
