// Type definitions for the Blockbench Headless SDK.

export type Vec3 = [number, number, number];
export type FormatId = 'free' | 'java_block' | 'bedrock' | 'bedrock_old' | 'image'
	| 'modded_entity' | 'optifine_jem' | 'optifine_jpm' | 'skin' | (string & {});
export type CodecId = 'project' | 'gltf' | 'obj' | 'fbx' | 'collada' | 'stl'
	| 'java_block' | 'bedrock' | 'image' | (string & {});
export type AngleName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric' | 'iso';

/** The Blockbench global namespace (advanced/escape-hatch access). */
export const BB: any;
export function resolveFormat(format?: FormatId | any): any;
export function listFormats(): Promise<string[]>;
export function listCodecs(): Promise<string[]>;

export interface CubeData {
	name?: string;
	from?: Vec3;
	to?: Vec3;
	origin?: Vec3;
	rotation?: Vec3;
	autouv?: 0 | 1 | 2;
	color?: number;
	faces?: Record<string, any>;
}
export interface GroupData {
	name?: string;
	origin?: Vec3;
	rotation?: Vec3;
}
export interface TextureOptions {
	name?: string;
	width?: number;
	height?: number;
	/** CSS color to fill the blank texture with. */
	fill?: string;
	/** Initialize from a data URL instead of a blank canvas. */
	dataUrl?: string;
}
export interface RenderOptions {
	width?: number;
	height?: number;
	angle?: AngleName | [number, number];   // [azimuthDeg, elevationDeg]
	background?: string | null;              // null = transparent
	fov?: number;
	ortho?: boolean;
	zoom?: number;
	distance?: number;
}
export type PaintFn = (ctx: any, info: { width: number; height: number; texture: any }) => void;

/** An isolated model project. Every method runs with this session active (cooperative). */
export class Session {
	readonly project: any;
	readonly id: string;
	name: string;
	readonly active: boolean;
	readonly format: any;
	readonly elements: any[];
	readonly groups: any[];
	readonly textures: any[];

	static create(format?: FormatId | any, opts?: { name?: string }): Session;

	activate(): this;
	run<T>(fn: (s: this) => T): T;
	edit<T>(name: string, fn: (s: this) => T, aspects?: any): T;
	undo(): void;
	redo(): void;

	setResolution(width: number, height: number): void;
	addCube(data?: CubeData, opts?: { group?: any | string }): any;
	addGroup(data?: GroupData, opts?: { parent?: any | string }): any;
	getElement(idOrName: string): any;
	remove(el: any | string): void;

	addTexture(opts?: TextureOptions): any;
	paint(texture: any, fn: PaintFn, opts?: { undo?: boolean; name?: string }): any;
	paintFace(texture: any, element: any, faceKey: string, fn: (ctx: any, rect: { x: number; y: number; w: number; h: number }) => void, opts?: any): any;
	applyTexture(element: any, texture: any, opts?: { faces?: string[] }): any;
	exportTexturePNG(texture: any): Buffer;

	exportProject(): string;                       // .bbmodel string
	export(codecId: CodecId, options?: any): Promise<any>;
	loadProject(model: string | object, path?: string): this;
	snapshot(): any;                               // bbmodel object

	openPreview(opts?: { port?: number; host?: string }): Promise<PreviewServer>;
	close(): void;
}

export function createSession(format?: FormatId | any, opts?: { name?: string }): Session;
export function listSessions(): Session[];

export function createImageSession(opts?: { name?: string; width?: number; height?: number; fill?: string }): { session: Session; texture: any };
export function faceUVRect(session: Session, element: any, faceKey: string, texture: any): [number, number, number, number];
export function readPixels(session: Session, texture: any): Uint8ClampedArray;

/** Render a session's model to a PNG Buffer (headless WebGL). */
export function renderSession(session: Session, options?: RenderOptions): Buffer;
export function renderAngles(session: Session, angles?: AngleName[], options?: RenderOptions): Record<string, Buffer>;

export class PreviewServer {
	readonly url: string;
	readonly port: number;
	start(): Promise<this>;
	broadcast(): void;
	stop(): Promise<void>;
}
export function openPreview(session: Session, opts?: { port?: number; host?: string }): Promise<PreviewServer>;

// --- worker pool ---
export interface WorkerStateInfo { id: number; sessionCount: number; }
export interface PoolState { workers: WorkerStateInfo[]; maxWorkers: number; maxSessionsPerWorker: number; }
export interface AllocRequest { format: string; hint?: any; }
export interface AllocResult { workerId: number | null; spawn: boolean; }

export abstract class Scheduler {
	abstract allocate(state: PoolState, request: AllocRequest): AllocResult | Promise<AllocResult>;
}
export class FixedScheduler extends Scheduler {
	allocate(state: PoolState, request: AllocRequest): AllocResult;
}
export class AgentScheduler extends Scheduler {
	constructor(decide: (state: PoolState, request: AllocRequest) => Promise<AllocResult>, opts?: { fallback?: Scheduler });
	allocate(state: PoolState, request: AllocRequest): Promise<AllocResult>;
}

export interface PaintCommand {
	op: 'fillRect' | 'clearRect' | 'fillPixel' | 'line';
	x?: number; y?: number; w?: number; h?: number;
	x1?: number; y1?: number; x2?: number; y2?: number;
	color?: string; width?: number;
}
/** Main-thread proxy for a session living in a worker process. All methods are async. */
export class SessionHandle {
	readonly id: string;
	readonly workerId: number;
	exec(op: string, ...args: any[]): Promise<any>;
	setResolution(w: number, h: number): Promise<true>;
	addCube(data?: CubeData, opts?: { group?: string }): Promise<{ uuid: string; name: string }>;
	addGroup(data?: GroupData, opts?: { parent?: string }): Promise<{ uuid: string; name: string }>;
	addTexture(opts?: TextureOptions): Promise<{ uuid: string; name: string }>;
	applyTexture(elementId: string, textureId: string, opts?: { faces?: string[] }): Promise<true>;
	paint(textureId: string, commands: PaintCommand[]): Promise<true>;
	loadProject(model: string | object, path?: string): Promise<true>;
	exportProject(): Promise<string>;
	export(codec: CodecId, opts?: any): Promise<any>;
	snapshot(): Promise<any>;
	listElements(): Promise<Array<{ uuid: string; name: string }>>;
	undo(): Promise<true>;
	redo(): Promise<true>;
	render(opts?: RenderOptions): Promise<Buffer>;
	close(): Promise<void>;
}

export class WorkerPool {
	constructor(opts?: { maxWorkers?: number; maxSessionsPerWorker?: number; scheduler?: Scheduler });
	readonly maxWorkers: number;
	readonly maxSessionsPerWorker: number;
	readonly stats: PoolState;
	createSession(format?: FormatId, opts?: { name?: string; hint?: any }): Promise<SessionHandle>;
	shutdown(): Promise<void>;
}
