// Stand-in for the explorer's ~system/EngineApi (the SDK's root module imports it).
export async function crdtSendToRenderer(_req: any): Promise<any> { return { data: [] } }
export async function sendBatch(): Promise<any> { return { events: [] } }
export async function subscribe(_req: any): Promise<any> { return {} }
export async function unsubscribe(_req: any): Promise<any> { return {} }
export async function crdtGetState(_req: any): Promise<any> { return { hasEntities: false, data: [] } }
export async function isServer(): Promise<any> { return { isServer: false } }
