declare module "occt-import-js" {
  interface OcctMeshAttributes {
    position: { array: number[] };
    normal?: { array: number[] };
  }

  interface OcctMesh {
    name?: string;
    color?: [number, number, number];
    attributes: OcctMeshAttributes;
    index?: { array: number[] };
  }

  interface OcctReadResult {
    success: boolean;
    meshes: OcctMesh[];
  }

  interface OcctModule {
    ReadStepFile: (buffer: Uint8Array, params: unknown) => OcctReadResult;
  }

  interface OcctInitOptions {
    locateFile?: (path: string) => string;
  }

  export default function occtimportjs(options?: OcctInitOptions): Promise<OcctModule>;
}
