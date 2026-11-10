import { prepareRenderer } from './babylon-renderer.js?v=0.3.0';
const $ = id => document.getElementById(id);
$('babylon-reload').onclick = () => location.reload();
$('babylon-webgl').onclick = () => { const url = new URL(location.href); url.searchParams.set('renderer', 'webgl'); location.assign(url); };
$('babylon-renderer-choice').value = new URLSearchParams(location.search).get('renderer') === 'webgl' ? 'webgl' : 'auto';
$('babylon-renderer-choice').onchange = event => {
  const url = new URL(location.href); url.searchParams.set('renderer', event.target.value); location.assign(url);
};
try {
  await prepareRenderer();
  await import('./app.js?v=0.3.0-babylon');
  $('babylon-loading').hidden = true;
} catch {
  $('babylon-loading').hidden = true; $('babylon-error').hidden = false;
}
