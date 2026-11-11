const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
const html = read('public/customer.html');
const pages = read('public/customer-pages.js');
const shell = read('public/premium-shell.js');
const css = read('public/customer-dashboard.css');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(html.includes('customer-dashboard.css') && html.includes('customer-pages.js?v=20261111-dashboard3'), 'Customer HTML must load the refreshed dashboard assets.');
assert(pages.includes('className = \'customer-home\'') && pages.includes('What can we move for you?'), 'Customer home dashboard must render its dedicated welcome panel.');
assert(['home','book','activity','wallet','account'].every(key => pages.includes(key + ': { title:')), 'Customer dashboard must provide separate Home, Book, Deliveries, Wallet and Account pages.');
assert(pages.includes('nav.innerHTML =') && pages.includes('data-page="home"') && pages.includes('data-page="book"'), 'Customer navigation must expose dedicated home and booking destinations.');
assert(pages.includes("root.addEventListener('click'") && pages.includes('history.pushState') && pages.includes("window.addEventListener('popstate'"), 'Customer page changes must stay in-app and support browser Back.');
assert(pages.includes("render(new URLSearchParams(location.search).get('page') || 'home', false)"), 'Signed-in customer default must be the Home dashboard.');
assert(shell.includes("if (app === 'customer') {") && !shell.includes('premium-quick-actions'), 'Premium shell must not inject a duplicate legacy customer action panel.');
assert(css.includes('.customer-home-actions') && css.includes('.customer-book-cta') && css.includes('@media(min-width:760px)'), 'Customer dashboard must include responsive action cards and a prominent booking action.');
assert(css.includes('body[data-app="customer"]') && !css.includes('body[data-app="driver"]'), 'Customer dashboard styles must be isolated from Driver and Company Admin.');
console.log('Customer dashboard structure, page navigation and responsive styling checks passed.');
