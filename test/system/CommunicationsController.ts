// Stand-in for the explorer's ~system/CommunicationsController (the SDK's network module imports it).
export async function send(_req: any): Promise<any> { return {} }
export async function sendBinary(_req: any): Promise<any> { return { data: [] } }
