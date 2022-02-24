import { TrackerChangeSet } from '@devicefarmer/adbkit/lib/TrackerChangeSet';
import { Device } from '../Device';
import { Service } from '../../services/Service';
import AdbKitClient from '@devicefarmer/adbkit/lib/adb/client';
import { AdbExtended } from '../adb';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import Tracker from '@devicefarmer/adbkit/lib/adb/tracker';
import Timeout = NodeJS.Timeout;
import { BaseControlCenter } from '../../services/BaseControlCenter';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import * as os from 'os';
import * as crypto from 'crypto';
import { DeviceState } from '../../../common/DeviceState';

export class ControlCenter extends BaseControlCenter<GoogDeviceDescriptor> implements Service {
    // Scrcpy的控制端
    private static readonly defaultWaitAfterError = 1000;
    private static instance?: ControlCenter;

    private initialized = false;
    private client: AdbKitClient = AdbExtended.createClient();
    private tracker?: Tracker;
    private waitAfterError = 1000;
    private restartTimeoutId?: Timeout;
    private deviceMap: Map<string, Device> = new Map(); // udid,device
    private descriptors: Map<string, GoogDeviceDescriptor> = new Map(); // udid,descriptor
    private readonly id: string;

    protected constructor() {
        super();
        const idString = `goog|${os.hostname()}|${os.uptime()}`;
        this.id = crypto.createHash('md5').update(idString).digest('hex');
    }

    public static getInstance(): ControlCenter {
        // 获取实例对象
        if (!this.instance) {
            this.instance = new ControlCenter();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        // 判断是否已生成控制对象实例
        return !!ControlCenter.instance;
    }

    private restartTracker = (): void => {
        // 重启Tracker对象
        if (this.restartTimeoutId) {
            return;
        }
        console.log(`Device tracker is down. Will try to restart in ${this.waitAfterError}ms`);
        this.restartTimeoutId = setTimeout(() => {
            this.stopTracker();
            this.waitAfterError *= 1.2;
            this.init();
        }, this.waitAfterError);
    };

    private onChangeSet = (changes: TrackerChangeSet): void => {
        // 未懂
        this.waitAfterError = ControlCenter.defaultWaitAfterError;
        if (changes.added.length) {
            for (const item of changes.added) {
                // 有设备插入
                const { id, type } = item;
                this.handleConnected(id, type);
            }
        }
        if (changes.removed.length) {
            // 有设备移除
            for (const item of changes.removed) {
                const { id } = item;
                this.handleConnected(id, DeviceState.DISCONNECTED);
            }
        }
        if (changes.changed.length) {
            // 设备状态变化
            for (const item of changes.changed) {
                const { id, type } = item;
                this.handleConnected(id, type);
            }
        }
    };

    private onDeviceUpdate = (device: Device): void => {
        // 当device变化时，重新发送一次设备信息
        const { udid, descriptor } = device;
        this.descriptors.set(udid, descriptor);
        this.emit('device', descriptor);
    };

    private handleConnected(udid: string, state: string): void {
        // 设备连接上时，改变状态或者创建对象
        let device = this.deviceMap.get(udid);
        if (device) {
            // 非初次连接，直接初始化设备对象
            device.setState(state);
        } else {
            // 首次连接上，准备创建对象，并执行初始化
            device = new Device(udid, state);
            device.on('update', this.onDeviceUpdate);
            this.deviceMap.set(udid, device);
        }
    }

    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }
        this.tracker = await this.startTracker();
        const list = await this.client.listDevices();
        list.forEach((device) => {
            const { id, type } = device;
            this.handleConnected(id, type);
        });
        this.initialized = true;
    }

    private async startTracker(): Promise<Tracker> {
        // 开启设备监控
        if (this.tracker) {
            return this.tracker;
        }
        const tracker = await this.client.trackDevices();
        // 监听事件注册，收到信号执行对应函数
        tracker.on('changeSet', this.onChangeSet);
        tracker.on('end', this.restartTracker);
        tracker.on('error', this.restartTracker);
        return tracker;
    }

    private stopTracker(): void {
        // 关闭adbkit的Tracker对象
        if (this.tracker) {
            // 注销事件监听，并关闭事件监听
            this.tracker.off('changeSet', this.onChangeSet);
            this.tracker.off('end', this.restartTracker);
            this.tracker.off('error', this.restartTracker);
            this.tracker.end();
            this.tracker = undefined;
        }
        this.tracker = undefined;
        this.initialized = false;
    }

    public getDevices(): GoogDeviceDescriptor[] {
        // 以列表的方式返回所有descriptors对象
        return Array.from(this.descriptors.values());
    }

    public getDevice(udid: string): Device | undefined {
        // 返回device对象
        return this.deviceMap.get(udid);
    }

    public getId(): string {
        // 返回加密的ID值
        return this.id;
    }

    public getName(): string {
        // 获取当前电脑的hostname
        return `aDevice Tracker [${os.hostname()}]`;
    }

    public start(): void {
        // 初始化对象实例
        this.init().catch((e) => {
            console.error(`Error: Failed to init "${this.getName()}". ${e.message}`);
        });
    }

    public release(): void {
        // 释放时关闭Tracker对象
        this.stopTracker();
    }

    public async runCommand(command: ControlCenterCommand): Promise<void> {
        // 依据控制命令执行对应操作：杀死、启动server; 更新设备的网络地址段
        const udid = command.getUdid();
        const device = this.getDevice(udid);
        if (!device) {
            console.error(`Device with udid:"${udid}" not found`);
            return;
        }
        const type = command.getType();
        switch (type) {
            case ControlCenterCommand.KILL_SERVER:
                await device.killServer(command.getPid());
                return;
            case ControlCenterCommand.START_SERVER:
                await device.startServer();
                return;
            case ControlCenterCommand.UPDATE_INTERFACES:
                await device.updateInterfaces();
                return;
            default:
                throw new Error(`Unsupported command: "${type}"`);
        }
    }
}
