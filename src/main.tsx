import { render } from 'preact';
import { App } from './ui/App';
import { load } from './ui/store';
import { applyTheme } from './ui/theme';
import './styles.css';

// Apply the saved theme before the first paint to avoid a flash.
applyTheme(load().settings.theme);

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
  });
}
