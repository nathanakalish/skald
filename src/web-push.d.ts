declare module 'web-push' {
	export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
	export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
	export function sendNotification(
		subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
		payload: string,
		options?: { TTL?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string }
	): Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
}
