import { describe, expect, it } from 'vitest';
import { CAPABILITIES, MATRIX, capabilitiesForAward } from './capabilities';
import { NAV } from '../lib/nav';

/**
 * The drift guard.
 *
 * A marketing site applies steady, quiet pressure to describe planned work as
 * real — nobody decides to overclaim, it happens one edit at a time when a
 * feature is nearly done. The first assertion below is the one that matters: a
 * capability may only claim `now` if the screen behind it is not still flagged
 * as a stub in the app's own nav.
 *
 * That flag is a good oracle precisely because it is maintained for a different
 * reason. `nav.ts` marks a section `stub: true` so the sidebar can say "soon"
 * and not walk a coach into an empty screen; it is updated by whoever builds the
 * feature, not by whoever writes the copy. So the copy cannot get ahead of the
 * product without this failing.
 *
 * NECESSARY BUT NOT SUFFICIENT, and that has already been proved the hard way. A
 * nav entry covers one route, and a route can be half built. /app/portfolio is
 * not a stub, because the candidates inbox on it genuinely works — but the
 * 15-page planner sharing that route does not exist, and the marketing site
 * claimed it shipped until somebody actually opened the screen.
 * `src/routes/Portfolio.tsx:33` had been saying "the planner is not built" the
 * whole time.
 *
 * So when a capability is finer-grained than its route, split it in two rather
 * than letting the working half vouch for the missing one. No assertion here can
 * do that for you. Open the screen.
 */
describe('capabilities', () => {
  it('never claims a capability ships while its screen is still a stub', () => {
    const overclaimed = CAPABILITIES.filter((c) => {
      if (c.status !== 'now' || !c.navTo) return false;
      return NAV.find((n) => n.to === c.navTo)?.stub === true;
    });

    expect(
      overclaimed.map((c) => `${c.key} -> ${c.navTo}`),
      'These say "In the alpha" on the marketing site but their nav entry is still stub: true. ' +
        'Either the feature shipped (drop the stub flag) or the copy is wrong (set status: soon).',
    ).toEqual([]);
  });

  it('points every navTo at a real nav entry', () => {
    // A typo'd path would silently opt a capability OUT of the check above,
    // which is the one way to defeat it by accident.
    const dangling = CAPABILITIES.filter(
      (c) => c.navTo && !NAV.some((n) => n.to === c.navTo),
    ).map((c) => `${c.key} -> ${c.navTo}`);

    expect(dangling).toEqual([]);
  });

  it('keeps every nav destination under /app', () => {
    // The marketing site owns the root. A nav entry that lost its prefix would
    // send a signed-in coach to a marketing page from inside the sidebar.
    expect(NAV.filter((n) => !n.to.startsWith('/app'))).toEqual([]);
  });

  it('has a comparison table that concedes what the alternatives do well', () => {
    // A matrix where the competition scores zero everywhere reads as marketing
    // and loses the argument it was built to win. Boards are the honest tie.
    expect(MATRIX.length).toBeGreaterThan(4);
    expect(MATRIX.some((c) => c.pm === 'yes')).toBe(true);
  });

  it('maps the awards that drive the whole product', () => {
    // Plan §2: Inspire is contender-for-Think plus a machine award plus a
    // team-attribute award, and it is worth 60 advancement points. If nothing
    // feeds Think, the product has lost its wedge.
    expect(capabilitiesForAward('think').length).toBeGreaterThan(0);
    expect(capabilitiesForAward('sustain').length).toBeGreaterThan(0);
    expect(capabilitiesForAward('reach').length).toBeGreaterThan(0);
  });
});
