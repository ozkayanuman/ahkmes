export interface BackendConnectorConfig {
  connectorType: "MANUAL" | "OPC_UA" | "M80";
  connectorConfig: Record<string, unknown> | null;
}

/**
 * Web'de (Automation Gateway → Bağlantı Ayarları) configure edilen bağlantı
 * tipini/parametrelerini backend'den çeker. Bu, connector'ı yalnızca yerel env
 * değişkenlerine bağımlı olmaktan çıkarıp, gerçekten "web'den yönetilebilir" hale
 * getirir. Env değişkenleri (`ADAPTER`, `OPCUA_ENDPOINT_URL`, `M80_HOST` vb.) her
 * zaman öncelikli kalır — bu sadece açıkça ayarlanmadıklarında kullanılan varsayılan.
 */
export async function fetchBackendConnectorConfig(
  backendUrl: string,
  machineId: string,
  machineKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BackendConnectorConfig | null> {
  try {
    const res = await fetchImpl(`${backendUrl}/machines/${machineId}/connector-config`, {
      headers: { "X-Machine-Key": machineKey },
    });
    if (!res.ok) return null;
    return (await res.json()) as BackendConnectorConfig;
  } catch {
    return null;
  }
}
