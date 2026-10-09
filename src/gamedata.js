// gamedata.js – the data tables of the game DLL: light styles (g_spawn.c) and
// the per-monster numbers from the m_*.c files, loaded into LIGHTSTYLES and
// MONSTER_TYPES by loader.js. Also the item and weapon tables the browser
// needs (models in hand, HUD icons).

// lightstyle(n, pattern): 'a' is dark, 'm' normal, 'z' double bright, 10 Hz (SP_worldspawn).
export const LIGHTSTYLES = [
  'm',                                                      // 0 normal
  'mmnmmommommnonmmonqnmmo',                                // 1 flicker
  'abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba',    // 2 slow strong pulse
  'mmmmmaaaaammmmmaaaaaabcdefgabcdefg',                     // 3 candle
  'mamamamamama',                                           // 4 fast strobe
  'jklmnopqrstuvwxyzyxwvutsrqponmlkj',                      // 5 gentle pulse
  'nmonqnmomnmomomno',                                      // 6 flicker 2
  'mmmaaaabcdefgmmmmaaaammmaamm',                           // 7 candle 2
  'mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa',             // 8 candle 3
  'aaaaaaaazzzzzzzz',                                       // 9 slow strobe
  'mmamammmmammamamaaamammma',                              // 10 fluorescent flicker
  'abcdefghijklmnopqrrqponmlkjihgfedcba',                   // 11 slow pulse, not to black
];
// styles 32–62 are switchable lights: 'a' off, 'm' on (set by triggers); 63 is always off
for (let i = 12; i < 63; i++) LIGHTSTYLES.push('m');
LIGHTSTYLES.push('a');

// Speeds are units per 10 Hz AI frame (ai_run(n) in the m_*.c). Boxes are the
// monsters' mins/maxs. Frames that fire are indices into the attack run.
export const MONSTERS = [
  {
    name: 'soldier_light', model: 'models/monsters/soldier/tris.md2', skin: 0, health: 20, gib_health: -30, mass: 100,
    run_speed: 10, walk_speed: 3, yaw_speed: 20,
    stand_anim: 'stand1', walk_anim: 'walk1', run_anim: 'run', pain_anims: 'pain1,pain2,pain3', death_anims: 'death1,death2,death3,death4,death5,death6',
    missile_anim: 'attak1', missile_frames: '2,4', missile_kind: 'blaster', attack_chance: 0.4, pain_chance: 1,
    sight_snd: 'soldier/solsght1.wav', idle_snd: 'soldier/solidle1.wav', search_snd: 'soldier/solsrch1.wav', pain_snd: 'soldier/solpain1.wav',
    death_snd: 'soldier/soldeth1.wav', attack_snd: 'soldier/solatck2.wav'
  },
  {
    name: 'soldier', model: 'models/monsters/soldier/tris.md2', skin: 2, health: 30, gib_health: -30, mass: 100,
    run_speed: 10, walk_speed: 3, yaw_speed: 20,
    stand_anim: 'stand1', walk_anim: 'walk1', run_anim: 'run', pain_anims: 'pain1,pain2,pain3', death_anims: 'death1,death2,death3,death4,death5,death6',
    missile_anim: 'attak1', missile_frames: '2', missile_kind: 'shotgun', attack_chance: 0.4, pain_chance: 1,
    sight_snd: 'soldier/solsght1.wav', idle_snd: 'soldier/solidle1.wav', search_snd: 'soldier/solsrch1.wav', pain_snd: 'soldier/solpain2.wav',
    death_snd: 'soldier/soldeth2.wav', attack_snd: 'soldier/solatck1.wav'
  },
  {
    name: 'soldier_ss', model: 'models/monsters/soldier/tris.md2', skin: 4, health: 40, gib_health: -30, mass: 100,
    run_speed: 10, walk_speed: 3, yaw_speed: 20,
    stand_anim: 'stand1', walk_anim: 'walk1', run_anim: 'run', pain_anims: 'pain1,pain2,pain3', death_anims: 'death1,death2,death3,death4,death5,death6',
    missile_anim: 'attak2', missile_frames: '3,4,5,6,7,8,9,10', missile_kind: 'machinegun', attack_chance: 0.4, pain_chance: 1,
    sight_snd: 'soldier/solsght1.wav', idle_snd: 'soldier/solidle1.wav', search_snd: 'soldier/solsrch1.wav', pain_snd: 'soldier/solpain3.wav',
    death_snd: 'soldier/soldeth3.wav', attack_snd: 'soldier/solatck3.wav'
  },
  {
    name: 'infantry', model: 'models/monsters/infantry/tris.md2', skin: 0, health: 100, gib_health: -40, mass: 200,
    run_speed: 10, walk_speed: 5, yaw_speed: 20,
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain1,pain2', death_anims: 'death1,death2,death3',
    melee_anim: 'attak2', melee_frame: 4, melee_range: 80, melee_dmg: 8,
    missile_anim: 'attak1', missile_frames: '3,4,5,6,7,8', missile_kind: 'machinegun', attack_chance: 0.4, pain_chance: 1,
    sight_snd: 'infantry/infsght1.wav', idle_snd: 'infantry/infidle1.wav', search_snd: 'infantry/infsrch1.wav', pain_snd: 'infantry/infpain1.wav',
    death_snd: 'infantry/infdeth1.wav', attack_snd: 'infantry/infatck1.wav', melee_snd: 'infantry/infatck2.wav'
  },
  {
    name: 'gunner', model: 'models/monsters/gunner/tris.md2', skin: 0, health: 175, gib_health: -70, mass: 200,
    run_speed: 12, walk_speed: 4, yaw_speed: 20,
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain1,pain2,pain3', death_anims: 'death',
    missile_anim: 'attak2', missile_frames: '8,9,10,11,12,13', missile_kind: 'machinegun', attack_chance: 0.4, pain_chance: 1,
    sight_snd: 'gunner/sight1.wav', idle_snd: 'gunner/gunidle1.wav', search_snd: 'gunner/gunsrch1.wav', pain_snd: 'gunner/gunpain1.wav',
    death_snd: 'gunner/death1.wav', attack_snd: 'gunner/gunatck2.wav'
  },
  {
    name: 'berserk', model: 'models/monsters/berserk/tris.md2', skin: 0, health: 240, gib_health: -60, mass: 250,
    run_speed: 21, walk_speed: 9, yaw_speed: 20,
    stand_anim: 'stand', walk_anim: 'walkc', run_anim: 'run', pain_anims: 'painc,painb', death_anims: 'death,deathc',
    melee_anim: 'spike', melee_frame: 4, melee_range: 80, melee_dmg: 15,
    attack_chance: 0, pain_chance: 1,
    sight_snd: 'berserk/sight.wav', idle_snd: 'berserk/idle.wav', search_snd: 'berserk/bersrch1.wav', pain_snd: 'berserk/berpain2.wav',
    death_snd: 'berserk/berdeth2.wav', melee_snd: 'berserk/attack.wav',
  },
  {
    name: 'flyer', model: 'models/monsters/flyer/tris.md2', skin: 0, health: 50, gib_health: -100, mass: 50, flags: 1,
    minz: -16, maxz: 16,
    run_speed: 10, walk_speed: 5, yaw_speed: 20,
    stand_anim: 'stand', walk_anim: 'stand', run_anim: 'stand', pain_anims: 'pain1,pain2,pain3', death_anims: 'pain1',
    melee_anim: 'attak1', melee_frame: 9, melee_range: 80, melee_dmg: 5,
    missile_anim: 'attak2', missile_frames: '5,6,7,8,9,10,11', missile_kind: 'blaster1', attack_chance: 0.5, pain_chance: 1,
    sight_snd: 'flyer/flysght1.wav', idle_snd: 'flyer/flyidle1.wav', search_snd: 'flyer/flysrch1.wav', pain_snd: 'flyer/flypain1.wav',
    death_snd: 'flyer/flydeth1.wav', attack_snd: 'flyer/flyatck3.wav', melee_snd: 'flyer/flyatck1.wav',
  },
  {
    name: 'parasite', model: 'models/monsters/parasite/tris.md2', skin: 0, health: 175, gib_health: -50, mass: 250,
    run_speed: 25, walk_speed: 10, yaw_speed: 30,
    stand_anim: 'stand', walk_anim: 'run', run_anim: 'run', pain_anims: 'pain1', death_anims: 'death1',
    // no melee: the drain is its attack (parasite_attack), chosen by M_CheckAttack's chances; parasite_drain runs it
    missile_anim: 'drain', attack_chance: 0.3, pain_chance: 1,
    sight_snd: 'parasite/parsght1.wav', idle_snd: 'parasite/paridle1.wav', search_snd: 'parasite/parsrch1.wav', pain_snd: 'parasite/parpain1.wav',
    death_snd: 'parasite/pardeth1.wav',
  },
  {
    name: 'tank', model: 'models/monsters/tank/tris.md2', skin: 0, health: 750, gib_health: -200, mass: 500,
    minx: -32, miny: -32, minz: -16, maxx: 32, maxy: 32, maxz: 72,
    run_speed: 4, walk_speed: 4, yaw_speed: 20,
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'walk', pain_anims: 'pain1,pain2,pain3', death_anims: 'death1',
    missile_anim: 'attak2', missile_frames: '23,26,29', missile_kind: 'rocket', attack_chance: 0.5, pain_chance: 0.5,
    sight_snd: 'tank/sight1.wav', idle_snd: 'tank/tnkidle1.wav', pain_snd: 'tank/pain.wav',
    death_snd: 'tank/death.wav', attack_snd: 'tank/rocket.wav',
  },
];

// Frame runs the models' names do not separate: [model, name, base run, offset, count] (m_berserk.c's spike and club)
export const EXTRA_ANIMS = [
  ['models/monsters/berserk/tris.md2', 'spike', 'att_c', 0, 8],
  ['models/monsters/berserk/tris.md2', 'club', 'att_c', 8, 12],
];

// WP_ bits → the model in hand and the HUD icon
export const WEAPONS = {
  1: { name: 'Blaster', view: 'models/weapons/v_blast/tris.md2', icon: 'w_blaster', ammo: null },
  2: { name: 'Shotgun', view: 'models/weapons/v_shotg/tris.md2', icon: 'w_shotgun', ammo: 'shells' },
  4: { name: 'Super Shotgun', view: 'models/weapons/v_shotg2/tris.md2', icon: 'w_sshotgun', ammo: 'shells' },
  8: { name: 'Machinegun', view: 'models/weapons/v_machn/tris.md2', icon: 'w_machinegun', ammo: 'bullets' },
  16: { name: 'Chaingun', view: 'models/weapons/v_chain/tris.md2', icon: 'w_chaingun', ammo: 'bullets' },
  32: { name: 'Grenades', view: 'models/weapons/v_handgr/tris.md2', icon: 'w_hgrenade', ammo: 'grenades' },
  64: { name: 'Grenade Launcher', view: 'models/weapons/v_launch/tris.md2', icon: 'w_glauncher', ammo: 'grenades' },
  128: { name: 'Rocket Launcher', view: 'models/weapons/v_rocket/tris.md2', icon: 'w_rlauncher', ammo: 'rockets' },
  256: { name: 'HyperBlaster', view: 'models/weapons/v_hyperb/tris.md2', icon: 'w_hyperblaster', ammo: 'cells' },
  512: { name: 'Railgun', view: 'models/weapons/v_rail/tris.md2', icon: 'w_railgun', ammo: 'slugs' },
  1024: { name: 'BFG10K', view: 'models/weapons/v_bfg/tris.md2', icon: 'w_bfg', ammo: 'cells' },
};
export const AMMO_ICONS = { shells: 'a_shells', bullets: 'a_bullets', grenades: 'a_grenades', rockets: 'a_rockets', cells: 'a_cells', slugs: 'a_slugs' };
export const ARMOR_ICONS = ['', 'i_jacketarmor', 'i_combatarmor', 'i_bodyarmor'];
/** g_items.c's itemlist: [pickup name, icon] by index (41 is health, which every health item shares). */
export const ITEMS = [null,
  ['Body Armor', 'i_bodyarmor'], ['Combat Armor', 'i_combatarmor'], ['Jacket Armor', 'i_jacketarmor'], ['Armor Shard', 'i_jacketarmor'],
  ['Power Screen', 'i_powerscreen'], ['Power Shield', 'i_powershield'],
  ['Blaster', 'w_blaster'], ['Shotgun', 'w_shotgun'], ['Super Shotgun', 'w_sshotgun'], ['Machinegun', 'w_machinegun'], ['Chaingun', 'w_chaingun'],
  ['Grenades', 'a_grenades'], ['Grenade Launcher', 'w_glauncher'], ['Rocket Launcher', 'w_rlauncher'], ['HyperBlaster', 'w_hyperblaster'],
  ['Railgun', 'w_railgun'], ['BFG10K', 'w_bfg'],
  ['Shells', 'a_shells'], ['Bullets', 'a_bullets'], ['Cells', 'a_cells'], ['Rockets', 'a_rockets'], ['Slugs', 'a_slugs'],
  ['Quad Damage', 'p_quad'], ['Invulnerability', 'p_invulnerability'], ['Silencer', 'p_silencer'], ['Rebreather', 'p_rebreather'],
  ['Environment Suit', 'p_envirosuit'], ['Ancient Head', 'i_fixme'], ['Adrenaline', 'p_adrenaline'], ['Bandolier', 'p_bandolier'], ['Ammo Pack', 'i_pack'],
  ['Data CD', 'k_datacd'], ['Power Cube', 'k_powercube'], ['Pyramid Key', 'k_pyramid'], ['Data Spinner', 'k_dataspin'], ['Security Pass', 'k_security'],
  ['Blue Key', 'k_bluekey'], ['Red Key', 'k_redkey'], ["Commander's Head", 'k_comhead'], ['Airstrike Marker', 'i_airstrike'],
  ['Health', 'i_health']];
/** The page's keys bound to "use <item>", as the inventory screen shows them (Key_KeynumToString). */
export const ITEM_KEYS = { 7: '1', 8: '2', 9: '3', 10: '4', 11: '5', 12: 'g', 13: '6', 14: '7', 15: '8', 16: '9', 17: '0', 23: 'q', 24: 'i', 26: 'b', 27: 'e' };
/** STAT_TIMER_ICON: quad, invulnerability, environment suit, rebreather. */
export const TIMER_ICONS = [null, 'p_quad', 'p_invulnerability', 'p_envirosuit', 'p_rebreather'];
