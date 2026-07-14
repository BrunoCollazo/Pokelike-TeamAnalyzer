// ==UserScript==
// @name         Pokelike Team Analyzer
// @namespace    https://pokelike.xyz/
// @version      1.23.0
// @description  Floating panel: team coverage, weaknesses, boss preview and catch/swap helpers
// @author       Bruno
// @match        https://pokelike.xyz/*
// @match        https://www.pokelike.xyz/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (window.__pokelikeCoverageInstalled) return;
  window.__pokelikeCoverageInstalled = true;

  // Tabla de tipos. El juego usa Gen 5, pero Fairy sí funciona (lo verifiqué con el daño real). Solo se listan los multiplicadores != 1; el resto es 1x
  // Ojo: en el juego, un 0 o un ×¼ hacen que el atacante haga Struggle (50 pot).
  const BUILTIN_CHART = {
    Normal:   {Rock:.5, Steel:.5, Ghost:0},
    Fire:     {Grass:2, Ice:2, Bug:2, Steel:2, Fire:.5, Water:.5, Rock:.5, Dragon:.5},
    Water:    {Fire:2, Ground:2, Rock:2, Water:.5, Grass:.5, Dragon:.5},
    Electric: {Water:2, Flying:2, Electric:.5, Grass:.5, Dragon:.5, Ground:0},
    Grass:    {Water:2, Ground:2, Rock:2, Fire:.5, Grass:.5, Poison:.5, Flying:.5, Bug:.5, Dragon:.5, Steel:.5},
    Ice:      {Grass:2, Ground:2, Flying:2, Dragon:2, Fire:.5, Water:.5, Ice:.5, Steel:.5},
    Fighting: {Normal:2, Ice:2, Rock:2, Dark:2, Steel:2, Poison:.5, Flying:.5, Psychic:.5, Bug:.5, Fairy:.5, Ghost:0},
    Poison:   {Grass:2, Fairy:2, Poison:.5, Ground:.5, Rock:.5, Ghost:.5, Steel:0},
    Ground:   {Fire:2, Electric:2, Poison:2, Rock:2, Steel:2, Grass:.5, Bug:.5, Flying:0},
    Flying:   {Grass:2, Fighting:2, Bug:2, Electric:.5, Rock:.5, Steel:.5},
    Psychic:  {Fighting:2, Poison:2, Psychic:.5, Steel:.5, Dark:0},
    Bug:      {Grass:2, Psychic:2, Dark:2, Fire:.5, Fighting:.5, Flying:.5, Ghost:.5, Steel:.5, Fairy:.5},
    Rock:     {Fire:2, Ice:2, Flying:2, Bug:2, Fighting:.5, Ground:.5, Steel:.5},
    Ghost:    {Psychic:2, Ghost:2, Dark:.5, Steel:.5, Normal:0},
    Dragon:   {Dragon:2, Steel:.5, Fairy:0},
    Dark:     {Psychic:2, Ghost:2, Fighting:.5, Dark:.5, Steel:.5, Fairy:.5},
    Steel:    {Ice:2, Rock:2, Fairy:2, Fire:.5, Water:.5, Electric:.5, Steel:.5},
    Fairy:    {Fighting:2, Dragon:2, Dark:2, Fire:.5, Poison:.5, Steel:.5},
  };

  // La tabla en vivo del juego manda; la integrada es el fallback.
  const getChart = () => window.TYPE_CHART || BUILTIN_CHART;

  // "fire"/"FIRE" -> "Fire"
  const norm = t => (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1).toLowerCase() : t);

  function eff(chart, atk, defs) {
    atk = norm(atk);
    if (!chart?.[atk]) return 1;
    return defs.reduce((m, d) => m * (chart[atk][norm(d)] ?? 1), 1);
  }

  // La cobertura sale del ATAQUE real del Pokémon, no de su tipo (STAB).
  const ALL_TYPES = ['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
    'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
  const TYPE_SET = new Set(ALL_TYPES);

  // Saca el tipo de un movimiento venga en la forma que venga.
  function typeFromMove(mv) {
    if (!mv) return null;
    if (typeof mv === 'string') { const t = norm(mv); return TYPE_SET.has(t) ? t : null; }
    const t = mv.type || mv.moveType || mv.element || mv.move?.type || mv.data?.type;
    return t && TYPE_SET.has(norm(t)) ? norm(t) : null;
  }

  // Fuente principal: la función del juego que resuelve el movimiento del Pokémon.
  function getMoveTypeViaGame(mon) {
    const pull = m => {
      for (const fn of ['getMoveForPokemon', 'getBestMove']) {
        if (typeof window[fn] === 'function') {
          let r;
          try { r = window[fn](m); } catch (_) { continue; }
          const t = typeFromMove(r);
          if (t) return t;
        }
      }
      return null;
    };
    let t = pull(mon);
    if (t) return t;
    // Si el mon no esta "cargado" todavía, carga buffs en una copia y reintenta
    try {
      if (typeof window.loadBuffsIntoPokemon === 'function' && mon && typeof mon === 'object') {
        const clone = JSON.parse(JSON.stringify(mon));
        window.loadBuffsIntoPokemon(clone);
        t = pull(clone);
        if (t) return t;
      }
    } catch (_) {}
    return null;
  }

  // Ultimo recurso: leer el tipo del movimiento de la carta si esta en pantalla.
  function getMoveTypeFromDOM(name) {
    for (const card of document.querySelectorAll('.poke-card')) {
      if (name && !(card.textContent || '').toLowerCase().includes(String(name).toLowerCase())) continue;
      const t = classType(card.querySelector('.poke-move .move-type-badge'));
      if (t) return t;
    }
    return null;
  }

  // Nombre del item desde un valor que puede venir como string u objeto {name}.
  function normItem(v) {
    if (!v) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'object') return (v.name || v.id || '').toString().trim() || null;
    return null;
  }

  // Item equipado leído del team-bar (mapa/menú principal): busca el slot cuyo
  // nombre coincide y lee el alt del ícono del item.
  function getItemFromDOM(name) {
    const bar = document.getElementById('team-bar');
    if (!bar || !name) return null;
    for (const slot of bar.querySelectorAll('.team-slot')) {
      const nm = slot.querySelector('.team-slot-name');
      if (!nm || nm.textContent.trim().toLowerCase() !== String(name).toLowerCase()) continue;
      const img = slot.querySelector('.team-slot-item img');
      if (img && img.alt) return img.alt.trim();
    }
    return null;
  }
  function getTeamFromDOM() {
    const bar = document.getElementById('team-bar');
    if (!bar) return null;
    const slots = bar.querySelectorAll('.team-slot');
    if (!slots.length) return null;
    return Array.from(slots).map(slot => {
      const name  = slot.querySelector('.team-slot-name')?.textContent.trim() || '?';
      const lvTxt = slot.querySelector('.team-slot-lv')?.textContent.trim() || '';
      const level = parseInt(lvTxt.replace(/\D/g, ''), 10) || 1;
      const fillEl = slot.querySelector('.hp-bar-fill');
      const hpPct = fillEl ? (parseFloat(fillEl.style.width) || 0) : 100; // "63%" -> 63
      const itemImg = slot.querySelector('.team-slot-item img');
      const item = itemImg && itemImg.alt ? itemImg.alt.trim() : null;
      return { name, level, hpPct, item };
    });
  }
  function getSpeciesTypesByName(name) {
    const dex = window.__POKEDEX__;
    if (!dex || !name) return null;
    const entries = Array.isArray(dex) ? dex : Object.values(dex);
    const hit = entries.find(e => e && (e.name || e.species || '').toString().toLowerCase() === name.toLowerCase());
    if (!hit) return null;
    if (hit.types?.length) return hit.types;
    if (Array.isArray(hit.type)) return hit.type;
    if (hit.type1) return hit.type2 ? [hit.type1, hit.type2] : [hit.type1];
    return null;
  }

  // El save queda viejo entre guardadas. Enganchamos renderPokemonCard para guardar los objetos vivos por referencia y ver move/HP al instante.
  const LIVE_MONS = new Map(); // _uid -> pokémon vivo
  let liveHookInstalled = false;

  function installLiveHook() {
    if (liveHookInstalled) return;
    const orig = window.renderPokemonCard;
    if (typeof orig !== 'function') return;      // aun no existe; se reintenta luego
    if (orig.__pcaWrapped) { liveHookInstalled = true; return; }
    const wrapped = function (pokemon, ...rest) {
      try {
        if (pokemon && pokemon._uid != null) LIVE_MONS.set(pokemon._uid, pokemon);
      } catch (_) {}
      return orig.apply(this, [pokemon, ...rest]);
    };
    wrapped.__pcaWrapped = true;
    window.renderPokemonCard = wrapped;
    liveHookInstalled = true;
    console.log('[PCA] renderPokemonCard hook installed (live moves)');
  }

  // Lideres de gimansio 
  const GYMS = {
    1: [
      {n:'Brock',    t:'Rock',     p:[['Geodude',['Rock','Ground']],['Onix',['Rock','Ground']]]},
      {n:'Misty',    t:'Water',    p:[['Staryu',['Water']],['Starmie',['Water','Psychic']]]},
      {n:'Lt.Surge', t:'Electric', p:[['Voltorb',['Electric']],['Pikachu',['Electric']],['Raichu',['Electric']]]},
      {n:'Erika',    t:'Grass',    p:[['Victreebel',['Grass','Poison']],['Tangela',['Grass']],['Vileplume',['Grass','Poison']]]},
      {n:'Koga',     t:'Poison',   p:[['Koffing',['Poison']],['Muk',['Poison']],['Koffing',['Poison']],['Weezing',['Poison']]]},
      {n:'Sabrina',  t:'Psychic',  p:[['Kadabra',['Psychic']],['Mr.Mime',['Psychic','Fairy']],['Venomoth',['Bug','Poison']],['Alakazam',['Psychic']]]},
      {n:'Blaine',   t:'Fire',     p:[['Growlithe',['Fire']],['Ponyta',['Fire']],['Rapidash',['Fire']],['Arcanine',['Fire']]]},
      {n:'Giovanni', t:'Ground',   p:[['Rhyhorn',['Ground','Rock']],['Dugtrio',['Ground']],['Nidoqueen',['Poison','Ground']],['Nidoking',['Poison','Ground']],['Rhyhorn',['Ground','Rock']]]},
    ],
    2: [
      {n:'Falkner',  t:'Flying',   p:[['Pidgey',['Normal','Flying']],['Pidgeotto',['Normal','Flying']]]},
      {n:'Bugsy',    t:'Bug',      p:[['Metapod',['Bug']],['Kakuna',['Bug','Poison']],['Scyther',['Bug','Flying']]]},
      {n:'Whitney',  t:'Normal',   p:[['Clefairy',['Fairy']],['Miltank',['Normal']]]},
      {n:'Morty',    t:'Ghost',    p:[['Gastly',['Ghost','Poison']],['Haunter',['Ghost','Poison']],['Haunter',['Ghost','Poison']],['Gengar',['Ghost','Poison']]]},
      {n:'Chuck',    t:'Fighting', p:[['Primeape',['Fighting']],['Poliwrath',['Water','Fighting']]]},
      {n:'Jasmine',  t:'Steel',    p:[['Magnemite',['Electric','Steel']],['Magnemite',['Electric','Steel']],['Steelix',['Steel','Ground']]]},
      {n:'Pryce',    t:'Ice',      p:[['Seel',['Water']],['Dewgong',['Water','Ice']],['Piloswine',['Ice','Ground']]]},
      {n:'Clair',    t:'Dragon',   p:[['Dragonair',['Dragon']],['Dragonair',['Dragon']],['Dragonair',['Dragon']],['Kingdra',['Water','Dragon']]]},
    ],
    3: [
      {n:'Roxanne',    t:'Rock',     p:[['Geodude',['Rock','Ground']],['Geodude',['Rock','Ground']],['Nosepass',['Rock']]]},
      {n:'Brawly',     t:'Fighting', p:[['Machop',['Fighting']],['Meditite',['Fighting','Psychic']],['Makuhita',['Fighting']]]},
      {n:'Wattson',    t:'Electric', p:[['Voltorb',['Electric']],['Electrike',['Electric']],['Magneton',['Electric','Steel']],['Manectric',['Electric']]]},
      {n:'Flannery',   t:'Fire',     p:[['Numel',['Fire','Ground']],['Slugma',['Fire']],['Camerupt',['Fire','Ground']],['Torkoal',['Fire']]]},
      {n:'Norman',     t:'Normal',   p:[['Slaking',['Normal']],['Spinda',['Normal']],['Vigoroth',['Normal']],['Slaking',['Normal']]]},
      {n:'Winona',     t:'Flying',   p:[['Swablu',['Normal','Flying']],['Tropius',['Grass','Flying']],['Pelipper',['Water','Flying']],['Skarmory',['Steel','Flying']],['Altaria',['Dragon','Flying']]]},
      {n:'Tate&Liza',  t:'Psychic',  p:[['Solrock',['Rock','Psychic']],['Lunatone',['Rock','Psychic']],['Claydol',['Ground','Psychic']]]},
      {n:'Wallace',    t:'Water',    p:[['Luvdisc',['Water']],['Whiscash',['Water','Ground']],['Sealeo',['Ice','Water']],['Seaking',['Water']],['Milotic',['Water']]]},
    ],
  };
  const ELITE4 = {
    1: [ // Kanto
      {n:'Lorelei', t:'Ice',      p:[['Dewgong',['Water','Ice'],54],['Cloyster',['Water','Ice'],53],['Slowbro',['Water','Psychic'],54],['Jynx',['Ice','Psychic'],56],['Lapras',['Water','Ice'],56]]},
      {n:'Bruno',   t:'Fighting', p:[['Onix',['Rock','Ground'],53],['Hitmonchan',['Fighting'],55],['Hitmonlee',['Fighting'],55],['Onix',['Rock','Ground'],54],['Machamp',['Fighting'],58]]},
      {n:'Agatha',  t:'Ghost',    p:[['Gengar',['Ghost','Poison'],54],['Golbat',['Poison','Flying'],54],['Haunter',['Ghost','Poison'],56],['Golbat',['Poison','Flying'],56],['Gengar',['Ghost','Poison'],58]]},
      {n:'Lance',   t:'Dragon',   p:[['Gyarados',['Water','Flying'],56],['Dragonite',['Dragon','Flying'],56],['Dragonair',['Dragon'],58],['Dragonair',['Dragon'],60],['Dragonite',['Dragon','Flying'],62]]},
      {n:'Gary (Champion)', t:'Mixed', p:[['Pidgeot',['Normal','Flying'],61],['Alakazam',['Psychic'],59],['Rhydon',['Ground','Rock'],61],['Exeggutor',['Grass','Psychic'],61],['Charizard',['Fire','Flying'],65]]},
    ],
    2: [ // Johto
      {n:'Will',    t:'Psychic',  p:[['Xatu',['Psychic','Flying'],76],['Xatu',['Psychic','Flying'],76],['Slowbro',['Water','Psychic'],78],['Jynx',['Ice','Psychic'],78],['Exeggutor',['Grass','Psychic'],80]]},
      {n:'Koga',    t:'Poison',   p:[['Ariados',['Bug','Poison'],80],['Venomoth',['Bug','Poison'],80],['Forretress',['Bug','Steel'],80],['Muk',['Poison'],80],['Crobat',['Poison','Flying'],84]]},
      {n:'Bruno',   t:'Fighting', p:[['Hitmontop',['Fighting'],86],['Hitmonlee',['Fighting'],86],['Hitmonchan',['Fighting'],86],['Onix',['Rock','Ground'],86],['Machamp',['Fighting'],86]]},
      {n:'Karen',   t:'Dark',     p:[['Umbreon',['Dark'],84],['Vileplume',['Grass','Poison'],84],['Gengar',['Ghost','Poison'],86],['Murkrow',['Dark','Flying'],86],['Houndoom',['Dark','Fire'],88]]},
      {n:'Lance (Champion)', t:'Dragon', p:[['Gyarados',['Water','Flying'],86],['Aerodactyl',['Rock','Flying'],87],['Dragonite',['Dragon','Flying'],88],['Dragonite',['Dragon','Flying'],89],['Dragonite',['Dragon','Flying'],90]]},
    ],
  };

  const TYPE_BOOST_ITEMS = {
    charcoal:'Fire', 'mystic water':'Water', 'miracle seed':'Grass', magnet:'Electric',
    nevermeltice:'Ice', 'nevermelt ice':'Ice', 'never-melt ice':'Ice', 'black belt':'Fighting',
    'poison barb':'Poison', 'soft sand':'Ground', 'sharp beak':'Flying', 'twisted spoon':'Psychic',
    silverpowder:'Bug', 'silver powder':'Bug', 'hard stone':'Rock', 'spell tag':'Ghost',
    'dragon fang':'Dragon', 'black glasses':'Dark', 'metal coat':'Steel', 'silk scarf':'Normal',
    'fairy feather':'Fairy',
  };
  const TYPE_BOOST_MULT = 1.4;  // Charcoal etc: +40%


  const CRIT_MULT = 2;
  function critExpectedMult(prob) { return 1 + prob * (CRIT_MULT - 1); }


  const KNOWN_COMBAT_ITEMS = new Set([
    ...Object.keys(TYPE_BOOST_ITEMS),
    'life orb', 'choice band', 'choice specs', 'expert belt', 'wide lens',
    'leftovers', 'shell bell', 'assault vest', 'eviolite', 'rocky helmet',
    'focus sash', 'air balloon', 'metronome',
    "king's rock", 'kings rock', 'scope lens', 'quick claw',
  ]);

  function applyItemEffects(item, atk, dealtAvg, takenAvg) {
    const key = (item || '').toLowerCase();
    if (!key) return { dealtAvg, takenAvg, note: '' };
    const notes = [];
    const takenBefore = takenAvg;

    const boostType = TYPE_BOOST_ITEMS[key];
    if (boostType && boostType === atk) { dealtAvg *= TYPE_BOOST_MULT; notes.push('+40% dmg'); }
    else if (key === 'life orb') { dealtAvg *= 1.3; notes.push('+30% dmg'); }
    else if (key === 'choice band') { dealtAvg *= 1.5; notes.push('+50% dmg (unconfirmed)'); }

    else if (key === 'choice specs') { dealtAvg *= 1.3; notes.push('+30% dmg (special)'); }

    else if (key === 'wide lens') { dealtAvg *= 1.2; notes.push('+20% dmg'); }

    else if (key === 'metronome') { dealtAvg *= 1.2; notes.push('+20% dmg'); }
    else if (key === "king's rock" || key === 'kings rock') {
      dealtAvg *= critExpectedMult(0.3); notes.push('+30% crit chance (assumes crit x2)');
    }
    else if (key === 'scope lens') {
      dealtAvg *= critExpectedMult(0.3); notes.push('+30% crit chance (assumes crit x2, unconfirmed)');
    }


    if (key === 'expert belt' && dealtAvg >= 2) { dealtAvg *= 2; notes.push('+100% (SE)'); }


    if (key === 'leftovers')          { takenAvg *= 0.90; }
    else if (key === 'shell bell')    { takenAvg = Math.max(0, takenAvg - dealtAvg * 0.15); }
    else if (key === 'assault vest')  { takenAvg *= 0.7; }

    else if (key === 'eviolite')      { takenAvg *= 0.67; }
    else if (key === 'rocky helmet')  { takenAvg *= 0.90; notes.push('12% max HP recoil to attacker on contact'); }
    else if (key === 'focus sash')    { notes.push('survives 1 hit, not factored into the number'); }
    else if (key === 'air balloon')   { notes.push('immune to first Ground hit, not factored into the number'); }
    else if (key === 'quick claw')    { takenAvg *= 0.90; notes.push('50% move-first chance, rough estimate'); }

    if (takenBefore > 0 && takenAvg < takenBefore - 0.001) {
      const pct = Math.round((1 - takenAvg / takenBefore) * 100);
      if (pct > 0) notes.push(`-${pct}% taken`);
    }

    return { dealtAvg, takenAvg, note: notes.join(' · ') };
  }

  function computeE4Order(chart, team, e4) {
    if (!chart || !team.length || !e4 || !e4.length) return null;

    const foeSeq = [];
    e4.forEach(trainer => {
      trainer.p.forEach(([foeName, foeTypes, foeLevel]) => {
        foeSeq.push({ trainerName: trainer.n, foeName, foeTypes, foeLevel });
      });
    });
    if (!foeSeq.length) return null;

    const itemPool = team.map(p => p.item).filter(it => it && KNOWN_COMBAT_ITEMS.has(it.toLowerCase()));
    const usedMons  = new Set();
    const usedItems = new Array(itemPool.length).fill(false);
    const assignments = [];

    const stickyItems = new Map();
    team.forEach((p, idx) => {
      if (p.item && !KNOWN_COMBAT_ITEMS.has(p.item.toLowerCase())) stickyItems.set(idx, p.item);
    });

    const scoreFor = (p, item, foe) => {
      let atk = (p.attackTypes && p.attackTypes[0]) || p.types[0];

      if ((item || '').toLowerCase() === 'metronome' && p.types && p.types.length > 1) {
        atk = p.types[1];
      }
      let dealt = eff(chart, atk, foe.foeTypes);
      let taken = eff(chart, foe.foeTypes[0], p.types); // ataca con su primer tipo
      if (foe.foeLevel) {
        const diff = (p.level || 1) - foe.foeLevel;
        const lvFactor = Math.min(1.5, Math.max(0.5, 1 + diff * 0.02));
        dealt *= lvFactor;
        taken /= lvFactor;
      }

      const fx = applyItemEffects(item, atk, dealt, taken);
      return { dealtAvg: fx.dealtAvg, takenAvg: fx.takenAvg, score: fx.dealtAvg * 0.4 - fx.takenAvg * 0.6, itemNote: fx.note };
    };

    const SCORE_EPS = 1e-9;
    const bestOptionFor = (p, idx, foe) => {
      const sNo = scoreFor(p, null, foe);
      let opt = { idx, itemIdx: -1, item: null, ...sNo };
      itemPool.forEach((it, ii) => {
        if (usedItems[ii]) return;
        const s2 = scoreFor(p, it, foe);
        const betterOrTiedAndUnequipped = opt.itemIdx === -1 && s2.score >= opt.score - SCORE_EPS;
        if (s2.score > opt.score || betterOrTiedAndUnequipped) opt = { idx, itemIdx: ii, item: it, ...s2 };
      });
      return opt;
    };

    // One team slot per rival mon, until we run out of Pokémon (after that
    // there isn't much left to plan in detail).
    const steps = Math.min(team.length, foeSeq.length);
    for (let i = 0; i < steps; i++) {
      const foe = foeSeq[i];
      let best = null;
      team.forEach((p, idx) => {
        if (usedMons.has(idx)) return;
        const opt = bestOptionFor(p, idx, foe);
        if (!best || opt.score > best.score) best = opt;
      });
      usedMons.add(best.idx);
      if (best.itemIdx >= 0) usedItems[best.itemIdx] = true;
      let suggestedItem = best.item, itemNote = best.itemNote;
      if (best.itemIdx < 0 && stickyItems.has(best.idx)) {
        suggestedItem = stickyItems.get(best.idx);
        itemNote = 'kept - effect not modeled by this tool';
      }
      assignments.push({
        trainerName: foe.trainerName, foeName: foe.foeName, member: team[best.idx],
        suggestedItem, dealtAvg: best.dealtAvg, takenAvg: best.takenAvg, itemNote,
      });
    }

    const backupIdx = team.map((_, i) => i).filter(i => !usedMons.has(i));
    const leftoverItems = itemPool.filter((_, ii) => !usedItems[ii]);
    const backupAssignments = backupIdx.map((i, pos) => ({
      member: team[i], item: leftoverItems[pos] || stickyItems.get(i) || null,
    }));

    return { assignments, backups: backupAssignments, totalFoes: foeSeq.length };
  }

  // DATOS DE ESPECIE (para modo Endless)
  function getSpeciesTypes(id) {
    const dex = window.__POKEDEX__;
    if (dex) {
      const e = Array.isArray(dex) ? dex[id] : dex[id];
      if (e?.types?.length) return e.types;
      if (Array.isArray(e?.type)) return e.type;
      if (e?.type1) return e.type2 ? [e.type1, e.type2] : [e.type1];
    }
    return null;
  }

  function getSpeciesName(id) {
    const dex = window.__POKEDEX__;
    if (dex) {
      const e = Array.isArray(dex) ? dex[id] : dex[id];
      if (e?.name) return e.name;
      if (e?.species) return e.species;
    }
    return '#' + id;
  }

  // LECTURA DE ESTADO
  function readState() {
    try {
      const run     = JSON.parse(localStorage.getItem('poke_current_run')   || '{}');
      const endless = JSON.parse(localStorage.getItem('poke_endless_state') || '{}');
      const gen     = parseInt(localStorage.getItem('poke_selected_gen')    || '1');
      return { run, endless, gen };
    } catch (e) {
      return { run: {}, endless: {}, gen: 1 };
    }
  }

  // De donde sale la cobertura (ataques reales o STAB), para mostrarlo en el panel.
  let ATTACK_SOURCE = 'types';

  function buildFromSave(p) {
    const live  = (p._uid != null && LIVE_MONS.get(p._uid)) || p;
    const name  = live.name || live.nickname || p.name || '?';
    const types = (Array.isArray(live.types) ? live.types : p.types || ['Normal']).map(norm);

    let moveType = getMoveTypeViaGame(live);
    if (!moveType && live !== p) moveType = getMoveTypeViaGame(p);
    if (!moveType) moveType = getMoveTypeFromDOM(name);
    const attackTypes = moveType ? [moveType] : types;
    const atkSrc      = moveType ? 'game' : 'stab';

    const item = normItem(live.item) || normItem(live.heldItem) || normItem(live.equippedItem) || normItem(p.item);

    return {
      name, types, attackTypes, atkSrc, item,
      shiny: live.isShiny ?? p.isShiny,
      level: live.level || p.level || 1,
      hp:    live.currentHp ?? p.currentHp ?? live.maxHp ?? p.maxHp ?? 1,
      maxHp: live.maxHp || p.maxHp || 1,
    };
  }

  function getTeam(run) {
    const srcSeen = new Set();
    const saveTeam = (run.team || []).map(buildFromSave);
    const domTeam = getTeamFromDOM();
    let team;
    if (domTeam && domTeam.length) {
      const saveLeft = saveTeam.slice(); // se van consumiendo a medida que matcheamos por nombre
      team = domTeam.map(d => {
        const idx = saveLeft.findIndex(s => s.name.toLowerCase() === d.name.toLowerCase());
        const matched = idx >= 0 ? saveLeft.splice(idx, 1)[0] : null;

        if (matched) {
          srcSeen.add(matched.atkSrc);
          return {
            ...matched,
            level: d.level || matched.level,          // el team-bar es el nivel más fresco
            hp:    Math.round((d.hpPct / 100) * matched.maxHp) || matched.hp,
            item:  matched.item || d.item,             // preferimos lo leído del objeto vivo si lo hay
          };
        }

        // Pokémon nuevo que el save todavía no tiene: no sabemos su tipo real
        // hasta que aparezca en el save, probamos el pokedex por nombre.
        const types = getSpeciesTypesByName(d.name) || ['Normal'];
        srcSeen.add('unknown');
        return {
          name: d.name, types, attackTypes: types, atkSrc: 'unknown', item: d.item,
          shiny: false, level: d.level, hp: d.hpPct, maxHp: 100,
        };
      });
    } else {
      // Sin team-bar en pantalla (otra vista del juego): al camino de siempre.
      team = saveTeam;
      saveTeam.forEach(p => srcSeen.add(p.atkSrc));
    }

    ATTACK_SOURCE = srcSeen.has('game') ? 'moves' : (srcSeen.has('unknown') ? 'types (algunos sin confirmar)' : 'types (STAB)');
    return team;
  }

  function getBosses(run, endless, gen) {
    const isEndless = endless.active === true || !!(endless.currentRegion?.trainers?.length);
    if (isEndless) {
      const trainers = endless.currentRegion?.trainers || [];
      const mapIdx   = endless.mapIndexInRegion ?? 0;
      return {
        mode: 'endless',
        bosses: trainers.slice(mapIdx, mapIdx + 3).map((t, i) => ({
          current:  i === 0,
          name:     t.archetype?.name || '?',
          gymType:  t.archetype?.type || '?',
          level:    t.displayLevel,
          team: (t.speciesIds || []).map(id => ({
            name:  getSpeciesName(id),
            types: getSpeciesTypes(id),
          })),
        })),
      };
    }

    const gymList = GYMS[gen] || GYMS[1];
    const badges  = run.badges || 0;
    const bosses  = [];
    for (let i = badges; i < Math.min(badges + 3, gymList.length); i++) {
      const g = gymList[i];
      bosses.push({
        current: i === badges,
        name:    g.n,
        gymType: g.t,
        level:   null,
        team:    g.p.map(([name, types]) => ({ name, types })),
      });
    }
    return { mode: 'run', bosses };
  }

  function analyze() {
    const chart = getChart();
    const { run, endless, gen } = readState();
    const team = getTeam(run);
    const { mode, bosses } = getBosses(run, endless, gen);

    const weaknesses = [], coverage = [];

    // Ofensivo = tipos de los ATAQUES; defensivo = tipos del Pokémon.
    const attackTypes = [...new Set(team.flatMap(p => p.attackTypes))];

    if (chart && team.length) {
      const allTypes = Object.keys(chart);

      // Detalle defensivo por Pokémon (para el hover). x0 y x1/4 van juntos como "struggle" porque el juego los trata igual.
      team.forEach(p => {
        const weak = [], resist = [], struggle = [];
        allTypes.forEach(atk => {
          const m = eff(chart, atk, p.types);
          if (m >= 2)                     weak.push({ t: atk, m });
          else if (m === 0 || m === 0.25) struggle.push({ t: atk, m });
          else if (m === 0.5)             resist.push({ t: atk, m });
        });
        weak.sort((a, b) => b.m - a.m);
        p.def = { weak, resist, struggle };
      });

      // Debilidad COMÚN: solo tipos que pegan x2+ a TODO el equipo.
      allTypes.forEach(atk => {
        const victims = team.filter(p => eff(chart, atk, p.types) >= 2).map(p => p.name);
        if (victims.length === team.length) weaknesses.push({ type: atk, count: victims.length, victims });
      });
      weaknesses.sort((a, b) => b.count - a.count);

      // Cobertura: ofensivo - usa los ataques reales, y guarda cuál da el hit.
      allTypes.forEach(def => {
        let best = 1, by = [];
        attackTypes.forEach(a => {
          const m = eff(chart, a, [def]);
          if (m > best) { best = m; by = [a]; }
          else if (m === best && m >= 2) { by.push(a); }
        });
        if (best >= 2) coverage.push({ type: def, best, by });
      });
      coverage.sort((a, b) => b.best - a.best);
    }

    // Orden sugerido: en run normal, cuando ya sacaste las 8 medallas, para toda la Elite Four (datos fijos). En modo Tower (endless), para los jefes que ya se ven en pantalla (datos reales leídos del save) -esto
    // incluye automáticamente al líder final de la etapa cuando entra en la ventana visible, sin necesidad de casos especiales.
    let e4Order = null;
    if (chart && team.length) {
      if (mode === 'run') {
        const gymCount = (GYMS[gen] || GYMS[1]).length;
        if ((run.badges || 0) >= gymCount && ELITE4[gen]) {
          e4Order = computeE4Order(chart, team, ELITE4[gen]);
        }
      } else if (mode === 'endless' && bosses.length) {
        // No hay nivel por-mon en el save de Tower, solo el del trainer
        // (displayLevel) - se lo asignamos a todos sus mons como aproximación.
        const trainerList = bosses
          .map(b => ({ n: b.name, p: (b.team || []).filter(m => m.types && m.types.length).map(m => [m.name, m.types, b.level || null]) }))
          .filter(t => t.p.length); // ignora jefes cuyos tipos todavía no cargaron
        if (trainerList.length) e4Order = computeE4Order(chart, team, trainerList);
      }
    }

    return { team, weaknesses, coverage, bosses, mode, gen,
             hasChart: !!chart, attackTypes, attackSource: ATTACK_SOURCE, e4Order };
  }

  //ESTILOS 
  const TC = {
    Normal:'#9a9a7a', Fire:'#f08030',    Water:'#6890f0',  Electric:'#f8d030',
    Grass:'#78c850',  Ice:'#98d8d8',     Fighting:'#c03028', Poison:'#a040a0',
    Ground:'#e0c068', Flying:'#a890f0',  Psychic:'#f85888', Bug:'#a8b820',
    Rock:'#b8a038',   Ghost:'#705898',   Dragon:'#7038f8',  Dark:'#705848',
    Steel:'#b8b8d0',  Fairy:'#ee99ac',
  };

  function injectStyles() {
    if (document.getElementById('tm-pca-styles')) return;
    const s = document.createElement('style');
    s.id = 'tm-pca-styles';
    s.textContent = `
#tm-pca {
  position:fixed;top:60px;right:8px;width:256px;z-index:99999;
  font-family:'Press Start 2P',monospace;font-size:7px;line-height:1.6;
  color:var(--text-main,#181410);
  background:var(--bg-card,#e0dcd0);
  border:2px solid var(--border,#3a3a3a);
  border-radius:8px;box-shadow:3px 3px 0 #181410;
  overflow:hidden;user-select:none;
}
body.dark-mode #tm-pca{box-shadow:3px 3px 0 #000}
#tm-pca-hdr {
  display:flex;align-items:center;justify-content:space-between;
  padding:5px 8px;background:var(--accent,#c89820);
  color:#181410;cursor:move;font-size:7px;
}
#tm-pca-hdr button {
  background:none;border:none;font-family:'Press Start 2P',monospace;
  font-size:10px;color:#181410;cursor:pointer;padding:0 2px;line-height:1;
}
#tm-pca-body {padding:6px 8px;max-height:78vh;overflow-y:auto;overflow-x:hidden}
#tm-pca-body.hidden{display:none}
.pca-sec{margin-bottom:7px;padding-bottom:7px;border-bottom:1px solid var(--border,#3a3a3a)}
.pca-sec:last-child{border-bottom:none;margin-bottom:0}
.pca-ttl{font-size:6px;color:var(--accent,#c89820);margin-bottom:4px;letter-spacing:.5px}
.pca-row{display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:2px;flex-wrap:wrap}
.pca-dim{color:var(--text-dim,#909080);font-size:6px}
.pca-chip{
  display:inline-block;padding:1px 4px;border-radius:3px;
  font-size:6px;color:#fff;margin:1px;white-space:nowrap;
}
.pca-hp{height:3px;background:var(--border,#3a3a3a);border-radius:2px;margin:1px 0 4px;overflow:hidden}
.pca-hp-f{height:100%;border-radius:2px;transition:width .4s}
.pca-sep{margin:5px 0;border:none;border-top:1px dashed var(--border,#3a3a3a)}
.pca-ok{color:#34d399}.pca-warn{color:#ffb020}.pca-bad{color:#ff4d4f}
.pca-mon{cursor:help}
.pca-mon-detail{display:none;padding:3px 4px 3px 6px;margin:0 0 4px;border-left:2px solid var(--accent,#c89820)}
.pca-mon:hover .pca-mon-detail{display:block}
.pca-drow{display:flex;align-items:center;flex-wrap:wrap;gap:1px;margin-bottom:2px}
.pca-dtag{font-size:5px;color:var(--text-dim,#909080);min-width:32px;margin-right:2px}
.pca-mult{font-size:5px;margin:0 3px 0 1px}
.pca-hint{padding-left:16px;margin-bottom:1px;font-size:6px}
.pca-catch{margin-top:4px;padding-top:4px;border-top:1px dashed rgba(0,0,0,.25);font-family:'Press Start 2P',monospace;font-size:7px;line-height:1.7;text-align:left;color:var(--text-main,#222)}
.pca-catch .row{margin-bottom:2px}
.pca-catch .lbl{font-size:6px;opacity:.7;margin-right:2px}
.pca-catch .lbl.g{color:#1a7a3a;opacity:1}
.pca-catch .lbl.b{color:#c0392b;opacity:1}
.pca-catch .none{opacity:.5;font-size:6px}
#tm-pca-ts{font-size:5px;color:var(--text-dim,#909080);text-align:right;padding:3px 8px 4px}
    `;
    document.head.appendChild(s);
  }

  function chip(t) {
    const bg = TC[t] || '#888';
    return `<span class="pca-chip" style="background:${bg}">${t}</span>`;
  }

  const multTxt = m => m === 0 ? '×0' : m === 0.25 ? '×¼' : m === 0.5 ? '×½' : ('×' + m);

  // Detalle defensivo de un Pokémon, visible al pasar el mouse por encima.
  function monDetail(p) {
    if (!p.def) return '';
    const { weak, resist, struggle } = p.def;
    const line = (label, arr, cls) => arr.length
      ? `<div class="pca-drow"><span class="pca-dtag ${cls}">${label}</span>${arr.map(x =>
          `${chip(x.t)}<span class="pca-mult ${cls}">${multTxt(x.m)}</span>`).join('')}</div>`
      : '';
    let d = '';
    d += line('Weak',    weak,   'pca-bad');
    d += line('Resists', resist, 'pca-ok');
    if (struggle.length) {
      d += `<div class="pca-drow"><span class="pca-dtag pca-ok">Struggle*</span>${struggle.map(x => chip(x.t)).join('')}</div>`;
      d += `<div class="pca-dim" style="font-size:5px">*×0 or ×¼ - foe uses Struggle (50 pow)</div>`;
    }
    if (!weak.length && !resist.length && !struggle.length) d += `<div class="pca-dim">All neutral</div>`;
    return `<div class="pca-mon-detail">${d}</div>`;
  }

  // RENDER
  function render({ team, weaknesses, coverage, bosses, mode, gen, hasChart, attackTypes = [], attackSource = 'tipos', e4Order = null }) {
    const chart = getChart();
    let h = '';

    const modeLabel = mode === 'endless' ? '🏆 Battle Tower' : `🎮 Normal Run · Gen ${gen}`;
    h += `<div class="pca-dim" style="margin-bottom:5px">${modeLabel}</div>`;
    h += `<div class="pca-dim" style="font-size:5px;margin-bottom:5px">⚔ coverage from: <b>${attackSource}</b></div>`;

    // Team
    h += `<div class="pca-sec"><div class="pca-ttl">▶ TEAM <span class="pca-dim" style="font-size:5px">(hover = weaknesses)</span></div>`;
    if (!team.length) {
      h += `<div class="pca-dim">No team</div>`;
    } else {
      team.forEach(p => {
        const pct = p.hp / p.maxHp;
        const fc  = pct > .5 ? '#34d399' : pct > .2 ? '#ffb020' : '#ff4d4f';
        const star = p.shiny ? `<span style="color:#ffb020">★</span>` : `<span style="opacity:0">★</span>`;
        const atkChips = (p.attackTypes || []).map(chip).join('');
        const atkQ = p.atkSrc === 'stab'
          ? `<span class="pca-dim" title="move not detected yet - using its type">?</span>` : '';
        h += `<div class="pca-mon" style="${p.hp===0?'opacity:.4':''}">
          <div class="pca-row">
            <span>${star} <b>${p.name}</b> <span class="pca-dim">Lv${p.level}</span></span>
            <span>${p.types.map(chip).join('')}</span>
          </div>
          <div class="pca-row" style="margin:0 0 2px">
            <span class="pca-dim" style="font-size:5px">⚔ move</span>
            <span>${atkChips}${atkQ}</span>
          </div>
          <div class="pca-hp"><div class="pca-hp-f" style="width:${(pct*100)|0}%;background:${fc}"></div></div>
          ${monDetail(p)}
        </div>`;
      });
    }
    h += `</div>`;

    if (!hasChart) {
      h += `<div class="pca-sec"><div class="pca-dim">⏳ Waiting for TYPE_CHART…</div></div>`;
    } else {
      // Shared weakness: only types that hit the WHOLE team x2+.
      h += `<div class="pca-sec"><div class="pca-ttl">▶ SHARED WEAKNESS</div>`;
      if (!weaknesses.length) {
        h += `<div class="pca-ok">✅ No type hits the whole team x2</div>`;
      } else {
        h += `<div class="pca-dim" style="font-size:5px;margin-bottom:2px">hits all ${team.length} x2+ 🔴</div>`;
        h += `<div class="pca-row">${weaknesses.map(w => chip(w.type)).join('')}</div>`;
      }
      h += `</div>`;

      // Offensive coverage - grouped by the move that lands the hit.
      h += `<div class="pca-sec"><div class="pca-ttl">▶ SE COVERAGE</div>`;
      if (!coverage.length) {
        h += `<div class="pca-dim">No SE advantage</div>`;
      } else {
        const byAtk = {};
        coverage.forEach(c => { c.by.forEach(a => { (byAtk[a] = byAtk[a] || []).push(c); }); });
        Object.entries(byAtk).forEach(([atk, list]) => {
          list.sort((a, b) => b.best - a.best);
          const targets = list.map(c =>
            chip(c.type) + (c.best >= 4 ? `<span class="pca-ok" style="font-size:5px">4x</span>` : '')
          ).join('');
          h += `<div class="pca-row" style="align-items:flex-start">
            <span style="flex:0 0 auto">${chip(atk)}<span class="pca-dim">-</span></span>
            <span style="flex:1;text-align:right">${targets}</span>
          </div>`;
        });
      }
      h += `</div>`;
    }

    // Bosses - current only by default; toggle to see the next ones.
    const togLbl = showAllBosses ? '[current only]' : '[see next]';
    const ttl    = showAllBosses ? 'NEXT BOSSES' : 'CURRENT BOSS';
    h += `<div class="pca-sec"><div class="pca-ttl">▶ ${ttl} <span id="pca-boss-tog" class="pca-dim" style="cursor:pointer;font-size:5px;text-decoration:underline">${togLbl}</span></div>`;
    const shownBosses = showAllBosses ? bosses : (bosses.filter(b => b.current).length ? bosses.filter(b => b.current) : bosses.slice(0, 1));
    if (!shownBosses.length) {
      h += `<div class="pca-dim">No boss data</div>`;
    } else {
      const atkT = attackTypes.length ? attackTypes : [...new Set(team.flatMap(p => p.types))];
      shownBosses.forEach((boss, bi) => {
        if (bi > 0) h += `<hr class="pca-sep">`;
        const arrow = boss.current ? '👉' : '   ';
        const lv = boss.level ? ` Lv${boss.level}` : '';
        h += `<div style="margin-bottom:3px">
          <span style="color:var(--accent,#c89820)">${arrow} ${boss.name}</span>
          <span class="pca-dim"> [${boss.gymType}]${lv}</span>
        </div>`;

        boss.team.forEach(mon => {
          if (!mon.types) {
            h += `<div class="pca-dim" style="padding-left:8px">? ${mon.name}</div>`;
            return;
          }
          const isGood = chart && atkT.some(a => eff(chart, a, mon.types) >= 2);
          const icon = isGood ? `<span class="pca-ok">✓</span>` : `<span class="pca-bad">✗</span>`;
          h += `<div class="pca-row" style="padding-left:8px">${icon} ${mon.name} ${mon.types.map(chip).join('')}</div>`;

          if (chart) {
            const best = atkT.map(a => ({ a, m: eff(chart, a, mon.types) }))
              .filter(x => x.m >= 2).sort((a, b) => b.m - a.m);
            const struggle = atkT.filter(a => {
              const m = eff(chart, a, mon.types); return m === 0 || m === 0.25;
            });
            if (best.length) {
              h += `<div class="pca-ok pca-hint">${best.slice(0, 3).map(x => x.a + '(' + x.m + 'x)').join(' ')}</div>`;
            } else {
              // No SE option: suggest which types WOULD hit x2 (to catch/plan).
              const seVs = Object.keys(chart).filter(a => eff(chart, a, mon.types) >= 2);
              h += `<div class="pca-warn pca-hint">need x2: ${seVs.map(chip).join('')}</div>`;
            }
            if (struggle.length) {
              h += `<div class="pca-dim pca-hint">Struggle 50: ${struggle.join('/')}</div>`;
            }
          }
        });
      });
    }
    h += `</div>`;

    // Suggested order for Elite Four/Tower - no healing or swaps between fights, so each rival mon gets the best free Pokémon (greedy) and the rest is backup. This is a type-based estimate, not a real simulation.
    if (e4Order) {
      const secTtl  = mode === 'endless' ? '▶ TOWER - SUGGESTED ORDER + ITEMS' : '▶ ELITE FOUR - SUGGESTED ORDER + ITEMS';
      const secDesc = mode === 'endless'
        ? 'for the next bosses visible - reassigns items from the pool - doesn\'t replace testing it in-game'
        : 'reassigns the items you already have equipped to whoever benefits most - doesn\'t replace testing it in-game';
      h += `<div class="pca-sec"><div class="pca-ttl">${secTtl}</div>`;
      h += `<div class="pca-dim" style="font-size:5px;margin-bottom:3px">${secDesc}</div>`;
      let lastTrainer = null;
      e4Order.assignments.forEach((a, i) => {
        if (a.trainerName !== lastTrainer) {
          h += `<div class="pca-dim" style="font-size:5px;margin-top:2px">— ${a.trainerName} —</div>`;
          lastTrainer = a.trainerName;
        }
        const cls = a.takenAvg <= 1 ? 'pca-ok' : a.takenAvg >= 2 ? 'pca-bad' : 'pca-warn';
        const itemTxt = a.suggestedItem
          ? ` <span class="pca-dim" style="font-size:5px">[${a.suggestedItem}${a.itemNote ? ' · ' + a.itemNote : ''}]</span>`
          : ` <span class="pca-dim" style="font-size:5px">[no item]</span>`;
        h += `<div class="pca-row">
          <span>${i + 1}. <b>${a.member.name}</b>${itemTxt} <span class="pca-dim">vs ${a.foeName}</span></span>
          <span class="${cls}" style="font-size:5px">deals x${a.dealtAvg.toFixed(1)} / takes x${a.takenAvg.toFixed(1)}</span>
        </div>`;
      });
      if (e4Order.totalFoes > e4Order.assignments.length) {
        h += `<div class="pca-dim" style="font-size:5px;margin-top:2px">(${e4Order.totalFoes - e4Order.assignments.length} more rival(s) left with no team member assigned - order repeats from #1)</div>`;
      }
      if (e4Order.backups.length) {
        const bkTxt = e4Order.backups.map(b => b.item ? `${b.member.name} [${b.item}]` : b.member.name).join(' → ');
        h += `<div class="pca-dim" style="font-size:5px;margin-top:3px">backup: ${bkTxt}</div>`;
      }
      h += `</div>`;
    }

    return h;
  }

  // PANEL DOM
  let panel, bodyEl, collapsed = false;

  // Mostrar todos los próximos jefes (toggle) o solo el actual. Por defecto: actual.
  let showAllBosses = false;
  try { showAllBosses = localStorage.getItem('_pca_boss_all') === '1'; } catch (_) {}

  function createPanel() {
    if (document.getElementById('tm-pca')) return;

    panel = document.createElement('div');
    panel.id = 'tm-pca';

    const hdr = document.createElement('div');
    hdr.id = 'tm-pca-hdr';
    hdr.innerHTML = `<span>⚔ Team Analyzer</span><button id="tm-pca-btn" title="Collapse">-</button>`;

    bodyEl = document.createElement('div');
    bodyEl.id = 'tm-pca-body';

    const ts = document.createElement('div');
    ts.id = 'tm-pca-ts';

    panel.appendChild(hdr);
    panel.appendChild(bodyEl);
    panel.appendChild(ts);
    document.body.appendChild(panel);

    // Toggle
    bodyEl.addEventListener('click', e => {
      const tg = e.target.closest && e.target.closest('#pca-boss-tog');
      if (!tg) return;
      showAllBosses = !showAllBosses;
      try { localStorage.setItem('_pca_boss_all', showAllBosses ? '1' : '0'); } catch (_) {}
      try { updatePanel(analyze(), true); } catch (_) {}
    });

    // Pausar el refresco mientras el mouse está sobre un Pokémon, para que el panel de debilidades (hover) no se destruya en cada actualización.
    bodyEl.addEventListener('mouseover', e => {
      if (e.target.closest && e.target.closest('.pca-mon')) hovering = true;
    });
    bodyEl.addEventListener('mouseout', e => {
      const toMon = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.pca-mon');
      if (!toMon) {
        hovering = false;
        if (pending) { const d = pending; pending = null; updatePanel(d, true); }
      }
    });

    // Mantiene al menos un pedazo del header visible dentro de la ventana.
    function clampPos(x, y) {
      const margin = 40;
      const maxX = window.innerWidth  - margin;
      const maxY = window.innerHeight - margin;
      return {
        x: Math.min(Math.max(x, margin - panel.offsetWidth), maxX),
        y: Math.min(Math.max(y, 0), maxY),
      };
    }

    // Restaurar posición guardada (con clamp por si cambió el tamaño de ventana)
    try {
      const saved = JSON.parse(localStorage.getItem('_pca_pos') || 'null');
      if (saved) {
        const pos = clampPos(saved.x, saved.y);
        panel.style.right = 'auto';
        panel.style.left  = pos.x + 'px';
        panel.style.top   = pos.y + 'px';
      }
    } catch (_) {}

    // Colapsar / expandir
    document.getElementById('tm-pca-btn').addEventListener('click', e => {
      e.stopPropagation();
      collapsed = !collapsed;
      bodyEl.classList.toggle('hidden', collapsed);
      ts.style.display = collapsed ? 'none' : '';
      document.getElementById('tm-pca-btn').textContent = collapsed ? '+' : '-';
    });

    // Arrastrar
    let drag = false, ox = 0, oy = 0;
    hdr.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      drag = true;
      const rect = panel.getBoundingClientRect();
      panel.style.left  = rect.left + 'px';
      panel.style.top   = rect.top + 'px';
      panel.style.right = 'auto';
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      const pos = clampPos(e.clientX - ox, e.clientY - oy);
      panel.style.left = pos.x + 'px';
      panel.style.top  = pos.y + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = false;
      try {
        localStorage.setItem('_pca_pos', JSON.stringify({ x: panel.offsetLeft, y: panel.offsetTop }));
      } catch (_) {}
    });
  }

  // Firma de lo que se muestra: si no cambió, no re-renderizamos (así el hover no parpadea).
  function dataSig(d) {
    try {
      return JSON.stringify([
        d.team.map(p => [p.name, p.level, p.hp, p.maxHp, p.types, p.attackTypes, p.item]),
        d.weaknesses.map(w => w.type),
        d.coverage.map(c => [c.by, c.type, c.best]),
        d.bosses.map(b => [b.name, b.current, b.team.map(m => [m.name, m.types])]),
        d.attackSource, d.mode, d.gen, d.hasChart,
        d.e4Order ? d.e4Order.assignments.map(a => [a.trainerName, a.foeName, a.member && a.member.name, a.suggestedItem]) : null,
      ]);
    } catch (_) { return 'x' + Math.random(); }
  }

  let lastSig = '', hovering = false, pending = null;

  function updatePanel(data, force) {
    if (!bodyEl) return;
    const sig = dataSig(data);
    if (!force && sig === lastSig) return;               // nada cambió - no tocar el DOM
    if (hovering && !force) { pending = data; return; }  // no romper el hover activo
    lastSig = sig;
    bodyEl.innerHTML = render(data);
    const ts = document.getElementById('tm-pca-ts');
    if (ts) ts.textContent = 'upd. ' + new Date().toLocaleTimeString();
  }

  const TYPE_CLASS = {
    normal:'Normal', fire:'Fire', water:'Water', electric:'Electric', grass:'Grass',
    ice:'Ice', fighting:'Fighting', poison:'Poison', ground:'Ground', flying:'Flying',
    psychic:'Psychic', bug:'Bug', rock:'Rock', ghost:'Ghost', dragon:'Dragon',
    dark:'Dark', steel:'Steel', fairy:'Fairy',
  };
  function classType(el) {
    if (!el) return null;
    for (const c of el.classList) {
      const m = /^type-([a-z]+)$/.exec(c);
      if (m && TYPE_CLASS[m[1]]) return TYPE_CLASS[m[1]];
    }
    return null;
  }
  function cardTypes(card) {
    return [...card.querySelectorAll('.poke-types .type-badge')].map(classType).filter(Boolean);
  }

  // En la pantalla de captura, anota qué aporta cada candidato: cobertura SE nueva, si tapa un hueco común, y qué amenazas resiste.
  function annotateCatchChoices() {
    const cont = document.getElementById('catch-choices');
    if (!cont) return;
    const chart = getChart();
    const team = getTeam(readState().run);
    if (!chart || !team.length) return;

    const allTypes = Object.keys(chart);
    const teamAtk  = [...new Set(team.flatMap(p => p.attackTypes))];
    const threats  = allTypes.filter(a => team.some(p => eff(chart, a, p.types) >= 2));
    const holes    = allTypes.filter(a => team.every(p => eff(chart, a, p.types) >= 2));
    const covered  = new Set(allTypes.filter(d => teamAtk.some(a => eff(chart, a, [d]) >= 2)));

    cont.querySelectorAll('.poke-card').forEach(card => {
      const types = cardTypes(card);
      if (!types.length) return;
      const move = classType(card.querySelector('.poke-move .move-type-badge'));

      const sig = types.join('/') + '|' + move + '|' + teamAtk.join(',') + '|' + holes.join(',');
      if (card.dataset.pcaSig === sig) return;
      card.dataset.pcaSig = sig;
      const prev = card.querySelector('.pca-catch');
      if (prev) prev.remove();

      const newCov = move ? allTypes.filter(d => eff(chart, move, [d]) >= 2 && !covered.has(d)) : [];
      const plugs  = holes.filter(a => eff(chart, a, types) < 2);
      const resist = threats.filter(a => eff(chart, a, types) < 1);

      let html = '';
      if (newCov.length) html += `<div class="row"><span class="lbl g">new SE:</span>${newCov.map(chip).join('')}</div>`;
      if (plugs.length)  html += `<div class="row"><span class="lbl">plugs hole:</span>${plugs.map(chip).join('')}</div>`;
      else if (resist.length) html += `<div class="row"><span class="lbl">resists:</span>${resist.slice(0, 6).map(chip).join('')}</div>`;
      if (!html) html = `<div class="none">no clear gain</div>`;

      const el = document.createElement('div');
      el.className = 'pca-catch';
      el.innerHTML = html;
      card.appendChild(el);
    });
  }

  // Equipo lleno: por cada miembro, muestra qué gana/pierde el equipo si lo cambiás por el que entra (cobertura y huecos comunes).
  function annotateSwapScreen() {
    const choices  = document.getElementById('swap-choices');
    const incoming = document.getElementById('swap-incoming');
    if (!choices || !incoming) return;
    const chart = getChart();
    const incCard = incoming.querySelector('.poke-card');
    if (!incCard || !chart) return;

    const inc = { types: cardTypes(incCard), move: classType(incCard.querySelector('.poke-move .move-type-badge')) };
    const cards = [...choices.querySelectorAll('.poke-card')];
    const members = cards.map(c => ({
      card: c, types: cardTypes(c),
      move: classType(c.querySelector('.poke-move .move-type-badge')),
    }));
    if (!members.length || !inc.types.length) return;

    const allTypes = Object.keys(chart);
    const coverageOf = ms => new Set(allTypes.filter(d => ms.some(m => m.move && eff(chart, m.move, [d]) >= 2)));
    const holesOf    = ms => new Set(allTypes.filter(a => ms.length && ms.every(m => eff(chart, a, m.types) >= 2)));

    const curCov = coverageOf(members);
    const curHoles = holesOf(members);

    // Firma de pantalla: si no cambió, no recalcular.
    const sig = JSON.stringify([members.map(m => [m.types, m.move]), inc.types, inc.move]);
    if (choices.dataset.pcaSwapSig === sig) return;
    choices.dataset.pcaSwapSig = sig;
    choices.querySelectorAll('.pca-catch').forEach(e => e.remove());

    members.forEach((mem, i) => {
      const newTeam  = members.filter((_, j) => j !== i).concat([inc]);
      const newCov   = coverageOf(newTeam);
      const newHoles = holesOf(newTeam);

      const gainCov    = [...newCov].filter(d => !curCov.has(d));
      const lostCov    = [...curCov].filter(d => !newCov.has(d));
      const holesGone  = [...curHoles].filter(a => !newHoles.has(a));   // bueno
      const holesAdded = [...newHoles].filter(a => !curHoles.has(a));   // malo

      let html = '';
      if (gainCov.length)    html += `<div class="row"><span class="lbl g">+cov:</span>${gainCov.map(chip).join('')}</div>`;
      if (lostCov.length)    html += `<div class="row"><span class="lbl b">−cov:</span>${lostCov.map(chip).join('')}</div>`;
      if (holesGone.length)  html += `<div class="row"><span class="lbl g">plugs:</span>${holesGone.map(chip).join('')}</div>`;
      if (holesAdded.length) html += `<div class="row"><span class="lbl b">opens:</span>${holesAdded.map(chip).join('')}</div>`;
      if (!html) return;  

      const el = document.createElement('div');
      el.className = 'pca-catch';
      el.innerHTML = html;
      mem.card.appendChild(el);
    });
  }

  // Corre las dos anotaciones de pantalla (captura/swap). Son baratas cada una corta al toque si no encuentra su contenedor, y si ya anotó la misma firma de cartas no vuelve a tocar el DOM- así que se pueden llamar seguido.
  function runAnnotations() {
    try { annotateCatchChoices(); }
    catch (e) { console.error('[PCA] catch-screen error:', e); }
    try { annotateSwapScreen(); }
    catch (e) { console.error('[PCA] swap-screen error:', e); }
  }

  let annotateQueued = false;
  function scheduleAnnotations() {
    if (annotateQueued) return;
    annotateQueued = true;
    requestAnimationFrame(() => { annotateQueued = false; runAnnotations(); });
  }
  const domObserver = new MutationObserver(scheduleAnnotations);

  // CICLO DE ACTUALIZACIÓN
  let timer = null;
  function tick() {
    if (!liveHookInstalled) installLiveHook();   // retry until the function exists
    try { updatePanel(analyze()); }
    catch (e) { console.error('[PCA] tick error (panel still alive):', e); }
    runAnnotations();   // respaldo, por si algún cambio se escapó del observer
    clearTimeout(timer);
    timer = setTimeout(tick, 2500);
  }

  window.addEventListener('storage', () => { try { updatePanel(analyze()); } catch (_) {} });

  function bootstrap() {
    injectStyles();
    createPanel();
    installLiveHook();
    domObserver.observe(document.body, { childList: true, subtree: true });
    scheduleAnnotations();
    tick();
  }

  if (document.body) {
    bootstrap();
  } else {
    document.addEventListener('DOMContentLoaded', bootstrap);
  }

  console.log('[Pokelike Team Analyzer] Active');
})();
