// Runs before the page is drawn, so the right screen is shown straight away (no flash of the wrong view).
document.body.dataset.view = /^#\/note\//.test(location.hash) ? 'editor' : location.hash === '#/' ? 'home' : 'landing';
