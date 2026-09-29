// Stand-in for the explorer's ~system/Runtime.
export async function getRealm(_req: any): Promise<any> { return { realmInfo: { isPreview: false, realmName: 'test', networkId: 1, commsAdapter: '', baseUrl: '' } } }
export async function getSceneInformation(_req: any): Promise<any> { return { urn: 'test', content: [], metadataJson: '{}', baseUrl: '' } }
export async function readFile(_req: any): Promise<any> { return { content: new Uint8Array(), hash: '' } }
export async function getExplorerInformation(_req: any): Promise<any> { return { agent: 'test', platform: 'test', configurations: {} } }
