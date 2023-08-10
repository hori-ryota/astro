// Note that this file is prebuilt to astro-island.prebuilt.ts
// Do not import this file directly, instead import the prebuilt one instead.
// pnpm --filter astro run prebuild

type directiveAstroKeys = 'load' | 'idle' | 'visible' | 'media' | 'only';

declare const Astro: {
	[k in directiveAstroKeys]?: (
		fn: () => Promise<() => void>,
		opts: Record<string, any>,
		root: HTMLElement
	) => void;
};

{
	// @ts-ignore
	(self.Astro || (self.Astro = {})).assign = (script,value) => Object.assign(script.parentElement,value);

	if (!customElements.get('astro-island')) {
		customElements.define(
			'astro-island',
			class extends HTMLElement {
				public Component: any;
				public hydrator: any;

				public opts: Record<string, any> = {};
				public props: Record<string, any> = {};
				public rendererUrl = '';
				public componentUrl = '';
				public componentExport = 'default';

				connectedCallback() {
					if (!this.hasAttribute('await-children') || this.firstChild) {
						this.childrenConnectedCallback();
					} else {
						// connectedCallback may run *before* children are rendered (ex. HTML streaming)
						// If SSR children are expected, but not yet rendered,
						// Wait with a mutation observer
						new MutationObserver((_, mo) => {
							mo.disconnect();
							// Wait until the next macrotask to ensure children are really rendered
							setTimeout(() => this.childrenConnectedCallback(), 0);
						}).observe(this, { childList: true });
					}
				}
				async childrenConnectedCallback() {
					let { beforeHydrationUrl } = this as any;
					if (beforeHydrationUrl) {
						await import(beforeHydrationUrl);
					}
					this.start();
				}
				start() {
					const { opts } = this;
					const client = this.getAttribute('client') as directiveAstroKeys;
					if (Astro[client] === undefined) {
						window.addEventListener(`astro:${client}`, () => this.start(), { once: true });
						return;
					}
					Astro[client]!(
						async () => {
							const { rendererUrl, componentUrl, componentExport = 'default' } = this;
							const [componentModule, { default: hydrator }] = await Promise.all([
								import(componentUrl),
								rendererUrl ? import(rendererUrl) : () => () => {},
							]);
							if (!componentExport.includes('.')) {
								this.Component = componentModule[componentExport];
							} else {
								this.Component = componentModule;
								for (const part of componentExport.split('.')) {
									this.Component = this.Component[part];
								}
							}
							this.hydrator = hydrator;
							return this.hydrate;
						},
						opts,
						this
					);
				}
				hydrate = async () => {
					// The client directive needs to load the hydrator code before it can hydrate
					if (!this.hydrator) return;

					// Make sure the island is mounted on the DOM before hydrating. It could be unmounted
					// when the parent island hydrates and re-creates this island.
					if (!this.isConnected) return;

					// Wait for parent island to hydrate first so we hydrate top-down. The `ssr` attribute
					// represents that it has not completed hydration yet.
					const parentSsrIsland = this.parentElement?.closest('astro-island[ssr]');
					if (parentSsrIsland) {
						parentSsrIsland.addEventListener('astro:hydrate', this.hydrate, { once: true });
						return;
					}

					const slotted = this.querySelectorAll('astro-slot');
					const slots: Record<string, string> = {};
					// Always check to see if there are templates.
					// This happens if slots were passed but the client component did not render them.
					const templates = this.querySelectorAll('template[data-astro-template]');
					for (const template of templates) {
						const closest = template.closest(this.tagName);
						if (!closest?.isSameNode(this)) continue;
						slots[template.getAttribute('data-astro-template') || 'default'] = template.innerHTML;
						template.remove();
					}
					for (const slot of slotted) {
						const closest = slot.closest(this.tagName);
						if (!closest?.isSameNode(this)) continue;
						slots[slot.getAttribute('name') || 'default'] = slot.innerHTML;
					}
					await this.hydrator(this)(this.Component, this.props, slots, {
						client: this.getAttribute('client'),
					});
					this.removeAttribute('ssr');
					this.dispatchEvent(new CustomEvent('astro:hydrate'));
				};
				attributeChangedCallback() {
					this.hydrate();
				}
			}
		);
	}
}
