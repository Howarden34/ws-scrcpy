import { Server as WSServer } from 'ws';
import WS from 'ws';
import querystring from 'querystring';
import url from 'url';
import { Service } from './Service';
import { HttpServer, ServerAndPort } from './HttpServer';
import { MwFactory } from '../mw/Mw';

export class WebSocketServer implements Service {
    // 开启面向前端的ws连接
    private static instance?: WebSocketServer;
    private servers: WSServer[] = [];
    private mwFactories: Set<MwFactory> = new Set();

    protected constructor() {
        // nothing here
    }

    public static getInstance(): WebSocketServer {
        // 单例模式，全局只有一个ws对象链接
        if (!this.instance) {
            this.instance = new WebSocketServer();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!this.instance;
    }

    public registerMw(mwFactory: MwFactory): void {
        this.mwFactories.add(mwFactory);
    }

    public attachToServer(item: ServerAndPort): WSServer {
        const { server, port } = item;
        const TAG = `WebSocket Server {tcp:${port}}`;
        const wss = new WSServer({ server });
        wss.on('connection', async (ws: WS, request) => {
            if (!request.url) {
                ws.close(4001, `[${TAG}] Invalid url`);
                return;
            }
            const parsedUrl = url.parse(request.url);
            const parsedQuery = querystring.parse(parsedUrl.query || '');
            let processed = false;
            for (const mwFactory of this.mwFactories.values()) {
                const service = mwFactory.processRequest(ws, { request, parsedUrl, parsedQuery });
                if (service) {
                    processed = true;
                }
            }
            if (!processed) {
                ws.close(4002, `[${TAG}] Unsupported request`);
            }
            return;
        });
        wss.on('close', () => {
            console.log(`${TAG} stopped`);
        });
        this.servers.push(wss);
        return wss;
    }

    public getServers(): WSServer[] {
        return this.servers;
    }

    public getName(): string {
        return `WebSocket Server Service`;
    }

    public start(): void {
        const service = HttpServer.getInstance();
        service.getServers().forEach((item) => {
            this.attachToServer(item);
        });
    }

    public release(): void {
        this.servers.forEach((server) => {
            server.close();
        });
    }
}
