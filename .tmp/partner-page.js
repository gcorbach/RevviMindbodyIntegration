$(document).ready(function () {
  // Bind these attributes on one wrapper enclosing the partner page:
  // data-partner-page, data-booking-flow, data-booking-link.
  const $page = $('[data-partner-page]').first();
  if (!$page.length) return;
  const flow = ($page.attr('data-booking-flow') || '').trim();
  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === 'true';
  const debugTier = params.get('tier');
  const preview = debug && Boolean(debugTier);
  const TIER_PLAN_MAP = {
    'member-complete': 'pln_revvi-complete-membership-fbe70883',
    'member-move': 'pln_revvi-move-membership-cue808no',
    'member-testing': 'pln_testing-free-plan-v65y0e68',
    'member-test-plan': 'pln_test-plan-0tv40j5v',
  };
  const $buttons = $page.find('[data-partner-booking-link]');
  const $anchors = $buttons.filter('a').add($buttons.children('a'));
  const $locations = $page.find('.dropdown-location .location-dropdown-name');
  let accessGranted = false;
  let destination = null;
  let selectedName = '';
  let invalidSelection = false;
  const log = (...args) => { if (debug) console.log('[Revvi Partner Debug]', ...args); };

  function validBookingLink(value) {
    if (!value || !['affiliate', 'revvi-booking'].includes(flow)) return null;
    try {
      const url = new URL(value, window.location.origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
      if (flow === 'revvi-booking') {
        if (url.origin !== window.location.origin || !['/book', '/book/'].includes(url.pathname)) return null;
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const one = (key) => url.searchParams.getAll(key).length === 1;
        if (!['businessSlug', 'locationId', 'offerId'].every(one)
          || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.searchParams.get('businessSlug') || '')
          || !uuid.test(url.searchParams.get('locationId') || '')
          || !uuid.test(url.searchParams.get('offerId') || '')) return null;
      }
      return url.href;
    } catch { return null; }
  }

  function renderBookingButton() {
    const enabled = accessGranted && !preview && Boolean(destination);
    $buttons.toggleClass('is-disabled', !enabled);
    if (enabled) {
      $anchors.attr('href', destination).removeAttr('aria-disabled').removeAttr('tabindex');
      if (flow === 'revvi-booking') $anchors.removeAttr('target');
    } else {
      $anchors.removeAttr('href').attr({ 'aria-disabled': 'true', tabindex: '-1' });
    }
    const text = preview ? 'Preview only'
      : invalidSelection ? 'Booking unavailable'
      : $locations.length && !destination ? 'Please select a location'
      : !destination ? 'Booking unavailable'
      : selectedName ? `Book at ${selectedName}` : 'Book now';
    $buttons.find('.btn-text').text(text);
  }

  function showAccessState(state) {
    accessGranted = state === 'correct-tier';
    $page.find('#offer-accordion, [data-partner-state], [data-partner-cta], .cta-non-member, [data-partner-access-error]').hide();
    if (state === 'correct-tier') $page.find('#offer-accordion').css('display', 'flex');
    if (state === 'correct-tier' || state === 'wrong-tier') {
      $page.find(`[data-partner-state="${state}"], [data-partner-cta="${state}"]`).css('display', 'flex');
    } else if (state === 'non-member') $page.find('.cta-non-member').css('display', 'flex');
    else if (state === 'error') $page.find('[data-partner-access-error]').show();
    renderBookingButton();
    log('Access display:', state);
  }

  async function initMemberstackTierAccess() {
    const tiers = $page.find('[data-tier-id]').map(function () { return ($(this).attr('data-tier-id') || '').trim(); }).get();
    // Exact plan IDs support CMS configuration without adding another JS tier alias.
    const planIds = new Set($page.find('[data-plan-id]').map(function () { return ($(this).attr('data-plan-id') || '').trim(); }).get().filter(Boolean));
    tiers.forEach(tier => { if (TIER_PLAN_MAP[tier]) planIds.add(TIER_PLAN_MAP[tier]); });
    showAccessState('loading');
    if (preview) {
      showAccessState(debugTier === 'non-member' ? 'non-member'
        : tiers.includes(debugTier) ? 'correct-tier' : 'wrong-tier');
      return;
    }
    try {
      // Memberstack may load after jQuery's ready callback.
      const deadline = Date.now() + 5000;
      while (!window.$memberstackDom?.getCurrentMember && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!window.$memberstackDom?.getCurrentMember) throw new Error('Memberstack unavailable');
      let timeout;
      const response = await Promise.race([
        window.$memberstackDom.getCurrentMember(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Memberstack timed out')), 10000); }),
      ]).finally(() => clearTimeout(timeout));
      const member = response?.data;
      if (!member) { showAccessState('non-member'); return; }
      if (!planIds.size) { showAccessState('error'); return; }
      const eligible = (member.planConnections || []).some(connection =>
        connection.active !== false
        && ['ACTIVE', 'TRIALING'].includes(String(connection.status || '').toUpperCase())
        && planIds.has(connection.planId));
      showAccessState(eligible ? 'correct-tier' : 'wrong-tier');
    } catch {
      showAccessState('error');
      log('Membership lookup failed; booking remains disabled.');
    }
  }

  function initLocationDropdownCityGroups() {
    $page.find('.dropdown-location').each(function () {
      const $dropdown = $(this);
      const $items = $dropdown.find('.location-dropdown-name');
      const $content = $dropdown.find('.location-dropdown-content').first();
      if (!$items.length || !$content.length) return;
      const groups = new Map();
      $items.each(function () {
        const $item = $(this);
        const city = ($item.attr('data-location-city') || '').trim() || 'Other';
        if (!groups.has(city)) groups.set(city, []);
        groups.get(city).push($item);
      });
      $items.detach(); // Preserve DOM state before removing CMS wrappers.
      $dropdown.find('.location-dropdown-content').not($content).remove();
      $content.empty();
      groups.forEach((items, city) => {
        const $group = $('<div class="location-dropdown-city-group"></div>');
        $group.append($('<div class="location-dropdown-city-label"></div>').text(city));
        items.forEach($item => $group.append($item));
        $content.append($group);
      });
    });
  }

  function initBookingLinks() {
    // The page link is only used when the page has no location selector.
    destination = $locations.length ? null : validBookingLink($page.attr('data-booking-link'));
    invalidSelection = !$locations.length && !destination;
    $anchors.on('click', function (event) {
      if (!accessGranted || preview || !destination) event.preventDefault();
    });
    $locations.not('a,button').attr({ role: 'button', tabindex: '0' });
    $page.find('.dropdown-location').on('click keydown', '.location-dropdown-name', function (event) {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      const $item = $(this);
      // Revvi links must identify THIS location and offer; never fall back to an affiliate URL.
      const link = flow === 'revvi-booking'
        ? $item.attr('data-location-booking-link')
        : $item.attr('data-location-link');
      selectedName = ($item.attr('data-location-name') || '').trim();
      destination = selectedName ? validBookingLink(link) : null;
      invalidSelection = !destination;
      $page.find('[data-selected-location]').text(selectedName || 'Select a location');
      renderBookingButton();
      if (destination) {
        $item.closest('.dropdown-location').find('.w-dropdown-toggle.w--open').first().trigger('click');
      }
    });
    renderBookingButton();
  }

  function initPrettyWebsiteLink() {
    const $link = $page.find('#website-link');
    const href = $link.attr('href');
    if (href) $link.text(href.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  }

  function initAccordion() {
    const $accordions = $page.find('[data-click="accordion"]');
    $accordions.find('.accordion_description-wrapper').css({ height: '0', overflow: 'hidden' });
    $accordions.on('click', function (event) {
      if ($(event.target).closest('a,input,select,textarea').length) return;
      const $clicked = $(this);
      const $content = $clicked.find('.accordion_description-wrapper').first();
      if (!$content.length) return;
      const wasOpen = $clicked.hasClass('open');
      $accordions.removeClass('open').find('.accordion_description-wrapper').css('height', '0');
      $accordions.find('.accordion-top-icon').css('transform', 'rotate(0deg)');
      if (!wasOpen) {
        $clicked.addClass('open');
        $content.css('height', $content[0].scrollHeight + 'px');
        $clicked.find('.accordion-top-icon').css('transform', 'rotate(180deg)');
      }
    });
  }

  function initGalleryThumbnails() {
    setTimeout(function () {
      $page.find('.img-gallery-subs-slide').each(function () {
        const index = $(this).index();
        $(this).on('click', () => $page.find('.img-gallery-main .w-slider-dot').eq(index).trigger('click'));
      });
    }, 500);
  }

  initLocationDropdownCityGroups();
  initBookingLinks();
  initMemberstackTierAccess();
  initPrettyWebsiteLink();
  initAccordion();
  initGalleryThumbnails();
});
