/* ============================================================
   mobile-menu.js
   Wires .mobile-menu-btn to toggle .nav-mobile.active.

   WHY THIS FILE EXISTS
   90 pages across six sites load /mobile-menu.js, but the file was
   never added to any repo. On those pages the request 404'd and the
   hamburger did nothing — the navigation could not be opened at all
   on a phone.

   WHY IT DEFERS INSTEAD OF JUST TOGGLING
   58 other pages load this file AND app.js, whose own handler works.
   A second unconditional handler there would toggle the menu twice
   per click and leave it looking dead — trading one broken set of
   pages for another.

   So this handler does not assume it is the only one. On click it
   notes the current state, yields, and acts only if nothing else
   changed it. Where app.js already works, this no-ops. Where nothing
   is wired, this does the toggle. No coordination flag is needed and
   app.js does not have to be edited.

   Behaviour matches the richest existing implementation, the one in
   wanderpuertorico/app.js: aria-expanded stays in sync, a click on a
   link inside the menu closes it, and Escape closes it.
   ============================================================ */
(function () {
    'use strict';

    function init() {
        var btn = document.querySelector('.mobile-menu-btn');
        var nav = document.querySelector('.nav-mobile');
        if (!btn || !nav) return;

        nav.id = nav.id || 'nav-mobile';
        if (!btn.hasAttribute('aria-controls')) btn.setAttribute('aria-controls', nav.id);
        if (!btn.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');

        function setOpen(open) {
            nav.classList.toggle('active', open);
            btn.classList.toggle('active', open);
            btn.setAttribute('aria-expanded', String(open));
        }

        // Capture phase, so `was` is read BEFORE any other click handler on
        // this button runs. Reading it in the bubble phase would see the state
        // app.js had already changed, and the deferred check would then undo it.
        btn.addEventListener('click', function () {
            var was = nav.classList.contains('active');
            setTimeout(function () {
                if (nav.classList.contains('active') === was) setOpen(!was);
            }, 0);
        }, true);

        nav.addEventListener('click', function (e) {
            if (e.target.tagName === 'A' && nav.classList.contains('active')) setOpen(false);
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && nav.classList.contains('active')) setOpen(false);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
