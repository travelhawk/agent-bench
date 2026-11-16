import { render } from '../src/app'
test('zeigt den Titel', () => { const el = document.createElement('div'); render(el); expect(el.querySelector('h1')?.textContent).toBe('Haushaltsbuch') })
