/* SPDX-License-Identifier: Apache-2.0 */
(() => {
  const header = document.querySelector('[data-site-header]');
  const dismiss = document.querySelector('[data-dismiss-banner]');
  const bannerKey = 'shukudai-note-promo-banner-hidden';

  const readBannerState = () => {
    try { return sessionStorage.getItem(bannerKey) === '1'; }
    catch { return false; }
  };

  const writeBannerState = () => {
    try { sessionStorage.setItem(bannerKey, '1'); }
    catch { /* The banner still closes for this page view. */ }
  };

  if (header && readBannerState()) header.classList.add('is-dismissed');

  dismiss?.addEventListener('click', () => {
    header?.classList.add('is-dismissed');
    writeBannerState();
  });

  if (header) {
    let previousY = window.scrollY;
    let ticking = false;
    const updateHeader = () => {
      const currentY = window.scrollY;
      const movingDown = currentY > previousY;
      header.classList.toggle('is-compact', currentY > 64 && movingDown && !header.classList.contains('is-dismissed'));
      if (!movingDown || currentY < 32) header.classList.remove('is-compact');
      previousY = currentY;
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateHeader);
        ticking = true;
      }
    }, { passive: true });
  }

  document.querySelectorAll('.mobile-menu a').forEach((link) => {
    link.addEventListener('click', () => link.closest('details')?.removeAttribute('open'));
  });
})();
