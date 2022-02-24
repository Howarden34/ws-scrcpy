import { Mw, RequestParameters } from './Mw';
import WS from 'ws';
import { ACTION } from '../../common/Action';

export class WebsocketProxy extends Mw {
    public static readonly TAG = 'WebsocketProxy';
    private remoteSocket?: WS;
    private released = false;
    private storage: WS.MessageEvent[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public static processRequest(ws: WS, params: RequestParameters): WebsocketProxy | undefined {
        const { parsedQuery } = params;
        if (!parsedQuery) {
            return;
        }
        if (parsedQuery.action !== ACTION.PROXY_WS) {
            return;
        }
        if (typeof parsedQuery.ws !== 'string') {
            ws.close(4003, `[${this.TAG}] Invalid value "${ws}" for "ws" parameter`);
            return;
        }
        return this.createProxy(ws, parsedQuery.ws);
    }

    public static createProxy(ws: WS, remoteUrl: string): WebsocketProxy {
        const service = new WebsocketProxy(ws);
        service.init(remoteUrl).catch((e) => {
            const msg = `[${this.TAG}] Failed to start service: ${e.message}`;
            console.error(msg);
            ws.close(4005, msg);
        });
        return service;
    }

    constructor(ws: WS) {
        super(ws);
    }

    public async init(remoteUrl: string): Promise<void> {
        this.name = `[${WebsocketProxy.TAG}{$${remoteUrl}}]`;
        const remoteSocket = new WS(remoteUrl);
        remoteSocket.onopen = () => {
            this.remoteSocket = remoteSocket;
            this.flush();
        };
        remoteSocket.onmessage = (event) => {
            // this.ws是与前端进行沟通的ws连接
            if (this.ws && this.ws.readyState === this.ws.OPEN) {
                if (Array.isArray(event.data)) {
                    event.data.forEach((data) => this.ws.send(data));
                } else {
                    this.ws.send(event.data);
                }
            }
        };
        remoteSocket.onclose = (e) => {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(e.wasClean ? 1000 : 4010);
            }
        };
        remoteSocket.onerror = (e) => {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(4011, e.message);
            }
        };
    }

    private flush(): void {
        if (this.remoteSocket) {
            while (this.storage.length) {
                // 数组开头弹出一个元素
                const event = this.storage.shift();
                if (event && event.data) {
                    this.remoteSocket.send(event.data);
                }
            }
            if (this.released) {
                this.remoteSocket.close();
            }
        }
        this.storage.length = 0;
    }

    protected onSocketMessage(event: WS.MessageEvent): void {
        if (this.remoteSocket) {
            // 收到前端发送过来的action数据，转发送给后端ADB的socket操作数据
            this.remoteSocket.send(event.data);
        } else {
            this.storage.push(event);
        }
    }

    public release(): void {
        if (this.released) {
            return;
        }
        super.release();
        this.released = true;
        this.flush();
    }
}
