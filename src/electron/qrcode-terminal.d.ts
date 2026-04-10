declare module "qrcode-terminal" {
	const qrcodeTerminal: {
		generate(text: string, opts?: { small?: boolean }, cb?: (qrcode: string) => void): void;
	};

	export default qrcodeTerminal;
}
