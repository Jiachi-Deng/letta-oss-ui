import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		value: vi.fn(),
		configurable: true,
	});

	class MockIntersectionObserver {
		observe = vi.fn();
		unobserve = vi.fn();
		disconnect = vi.fn();
	}

	Object.defineProperty(window, "IntersectionObserver", {
		value: MockIntersectionObserver,
		configurable: true,
	});
}
