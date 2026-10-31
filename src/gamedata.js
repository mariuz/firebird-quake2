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
  // ── the full game's monsters (m_*.c, m_*.h), logic first: the demo pak has neither their models nor their sounds, so
  // each carries its frame runs (`anims`: [name, count] in the model's order, from the m_*.h headers) for a model row
  // without a mesh; a registered pak's MD2 takes over. Their special behaviours still to come are in the roadmap.
  {
    name: 'gladiator', model: 'models/monsters/gladiatr/tris.md2', skin: 0, health: 400, gib_health: -175, mass: 400,
    minx: -32, miny: -32, minz: -24, maxx: 32, maxy: 32, maxz: 64,
    run_speed: 23, walk_speed: 8, yaw_speed: 20,
    anims: [['stand', 7], ['walk', 16], ['run', 6], ['melee', 17], ['attack', 9], ['pain', 6], ['painup', 7], ['death', 22]],
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain,painup', death_anims: 'death',
    melee_anim: 'melee', melee_frame: 11, melee_range: 80, melee_dmg: 20,       // GladiatorCleaver: 20 + rand()%5
    missile_anim: 'attack', missile_frames: '3', missile_kind: 'railgun', attack_chance: 0.3, pain_chance: 1,   // GladiatorGun: 50 damage, 100 kick
    sight_snd: 'gladiator/sight.wav', idle_snd: 'gladiator/gldidle1.wav', search_snd: 'gladiator/gldsrch1.wav', pain_snd: 'gladiator/pain.wav',
    death_snd: 'gladiator/glddeth2.wav', attack_snd: 'gladiator/railgun.wav', melee_snd: 'gladiator/melee2.wav',
  },
  {
    name: 'chick', model: 'models/monsters/bitch/tris.md2', skin: 0, health: 175, gib_health: -70, mass: 200,
    minx: -16, miny: -16, minz: 0, maxx: 16, maxy: 16, maxz: 56,
    run_speed: 10, walk_speed: 6, yaw_speed: 20,
    anims: [['attak1', 32], ['attak2', 16], ['death1', 12], ['death2', 23], ['duck', 7], ['pain1', 5], ['pain2', 5], ['pain3', 21], ['stand1', 30], ['stand2', 30], ['walk', 10], ['run', 10]],
    stand_anim: 'stand1', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain1,pain2,pain3', death_anims: 'death1,death2',
    melee_anim: 'attak2', melee_frame: 7, melee_range: 80, melee_dmg: 10,      // ChickSlash: 10 + rand()%6; chick_dodge: a duck a quarter of the time
    missile_anim: 'attak1', missile_frames: '13', missile_kind: 'rocket', attack_chance: 0.3, pain_chance: 1,   // ChickRocket: 50 damage at 500
    sight_snd: 'chick/chksght1.wav', idle_snd: 'chick/chkidle1.wav', search_snd: 'chick/chksrch1.wav', pain_snd: 'chick/chkpain1.wav',
    death_snd: 'chick/chkdeth1.wav', attack_snd: 'chick/chkatck2.wav', melee_snd: 'chick/chkatck4.wav',
  },
  {
    name: 'brain', model: 'models/monsters/brain/tris.md2', skin: 0, health: 300, gib_health: -150, mass: 400,
    minx: -16, miny: -16, minz: -32, maxx: 16, maxy: 16, maxz: 32,
    run_speed: 9, walk_speed: 9, yaw_speed: 10,
    anims: [['walk1', 11], ['walk2', 40], ['attack1', 18], ['attack2', 17], ['pain3', 6], ['pain2', 8], ['pain1', 21], ['death2', 5], ['death1', 18], ['duck', 8], ['defense', 9], ['stand', 30], ['idle', 30]],
    stand_anim: 'stand', walk_anim: 'walk1', run_anim: 'walk1', pain_anims: 'pain1,pain2,pain3', death_anims: 'death1,death2',
    melee_anim: 'attack1', melee_frame: 7, melee_range: 80, melee_dmg: 15,     // brain_hit_right: 15 + rand()%5
    attack_chance: 0, pain_chance: 1,
    sight_snd: 'brain/brnsght1.wav', idle_snd: 'brain/brnidle1.wav', search_snd: 'brain/brnsrch1.wav', pain_snd: 'brain/brnpain1.wav',
    death_snd: 'brain/brndeth1.wav', melee_snd: 'brain/melee1.wav',
  },
  {
    name: 'medic', model: 'models/monsters/medic/tris.md2', skin: 0, health: 300, gib_health: -130, mass: 400,
    minx: -24, miny: -24, minz: -24, maxx: 24, maxy: 24, maxz: 32,
    run_speed: 18, walk_speed: 6, yaw_speed: 20,
    anims: [['walk', 12], ['attack', 14], ['attack2', 27], ['duck', 16], ['death', 30], ['pain1', 8], ['pain2', 15], ['run', 6], ['stand', 90]],
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain1,pain2', death_anims: 'death',
    // medic_fire_blaster: 2-damage bolts at 1000 from the attack frames; over a dead monster the cable (attack2) that raises
    // it (medic_cable in monsters.sql), and a duck under a shot a quarter of the time (medic_dodge)
    missile_anim: 'attack', missile_frames: '3,4,5,6,7,8,9,10', missile_kind: 'bolt2', attack_chance: 0.3, pain_chance: 1,
    sight_snd: 'medic/medsght1.wav', idle_snd: 'medic/idle.wav', search_snd: 'medic/medsrch1.wav', pain_snd: 'medic/medpain1.wav',
    death_snd: 'medic/meddeth1.wav', attack_snd: 'medic/medatck1.wav',
  },
  {
    name: 'mutant', model: 'models/monsters/mutant/tris.md2', skin: 0, health: 300, gib_health: -120, mass: 300,
    minx: -32, miny: -32, minz: -24, maxx: 32, maxy: 32, maxz: 48,
    run_speed: 40, walk_speed: 3, yaw_speed: 20,
    anims: [['attack', 15], ['death1', 9], ['death2', 10], ['pain1', 5], ['pain2', 6], ['pain3', 11], ['run', 6], ['stand', 51], ['walk', 13], ['jump', 8]],
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain1,pain2,pain3', death_anims: 'death1,death2',
    // mutant_hit_left: 10 + rand()%6; the swipe reaches a stride past where SV_CloseEnough stops a 64-wide monster at the
    // player's box on a diagonal (68 + 40): with Quake's 80 it stood there and never struck. Its "missile" is the leap
    // (mutant_check_jump, mutant_jump: the jump frames, 425 forward and 160 up, 40 + 10 * random() to what it lands on)
    melee_anim: 'attack', melee_frame: 3, melee_range: 112, melee_dmg: 10,
    missile_anim: 'jump', attack_chance: 0, pain_chance: 1,
    sight_snd: 'mutant/mutsght1.wav', idle_snd: 'mutant/mutidle1.wav', search_snd: 'mutant/mutsrch1.wav', pain_snd: 'mutant/mutpain1.wav',
    death_snd: 'mutant/mutdeth1.wav', melee_snd: 'mutant/mutatck2.wav',
  },
  {
    name: 'hover', model: 'models/monsters/hover/tris.md2', skin: 0, health: 240, gib_health: -100, mass: 150, flags: 1,
    minx: -24, miny: -24, minz: -24, maxx: 24, maxy: 24, maxz: 32,
    run_speed: 10, walk_speed: 4, yaw_speed: 20,
    anims: [['stand', 30], ['forward', 35], ['stop1', 9], ['stop2', 8], ['takeoff', 30], ['land', 1], ['pain3', 9], ['pain2', 12], ['pain1', 28], ['attak1', 8], ['attak2', 8], ['death1', 11], ['backward', 24]],
    stand_anim: 'stand', walk_anim: 'forward', run_anim: 'forward', pain_anims: 'pain1,pain2,pain3', death_anims: 'death1',
    missile_anim: 'attak1', missile_frames: '1,2,3,4,5,6', missile_kind: 'bolt1', attack_chance: 0.3, pain_chance: 1,   // hover_fire_blaster: 1 damage at 1000
    sight_snd: 'hover/hovsght1.wav', idle_snd: 'hover/hovidle1.wav', search_snd: 'hover/hovsrch1.wav', pain_snd: 'hover/hovpain1.wav',
    death_snd: 'hover/hovdeth1.wav', attack_snd: 'hover/hovatck1.wav',
  },
  {
    name: 'floater', model: 'models/monsters/float/tris.md2', skin: 0, health: 200, gib_health: -80, mass: 300, flags: 1,
    minx: -24, miny: -24, minz: -24, maxx: 24, maxy: 24, maxz: 32,
    run_speed: 13, walk_speed: 5, yaw_speed: 30,
    anims: [['actvat', 31], ['attak1', 14], ['attak2', 25], ['attak3', 34], ['death', 13], ['pain1', 7], ['pain2', 8], ['stand1', 52], ['stand2', 52]],
    stand_anim: 'stand1', walk_anim: 'stand2', run_anim: 'stand2', pain_anims: 'pain1,pain2', death_anims: 'death',
    // floater_zap: 5 + rand()%6 of energy damage with a pull of 10, a splash of 32 sparks from its muzzle (monster_melee)
    melee_anim: 'attak2', melee_frame: 7, melee_range: 80, melee_dmg: 5,
    missile_anim: 'attak1', missile_frames: '3,4,5,6,7,8,9', missile_kind: 'bolt1', attack_chance: 0.3, pain_chance: 1,   // floater_fire_blaster: 1 damage at 1000
    sight_snd: 'floater/fltsght1.wav', idle_snd: 'floater/fltidle1.wav', search_snd: 'floater/fltsrch1.wav', pain_snd: 'floater/fltpain1.wav',
    death_snd: 'floater/fltdeth1.wav', attack_snd: 'floater/fltatck3.wav', melee_snd: 'floater/fltatck2.wav',
  },
  {
    name: 'flipper', model: 'models/monsters/flipper/tris.md2', skin: 0, health: 50, gib_health: -30, mass: 100, flags: 2,
    minx: -16, miny: -16, minz: 0, maxx: 16, maxy: 16, maxz: 32,
    run_speed: 24, walk_speed: 4, yaw_speed: 10,
    anims: [['flphor', 24], ['flpver', 29], ['flppn1', 5], ['flppn2', 5], ['flpbit', 20], ['flptal', 21], ['flpdth', 56], ['flpstr', 5]],
    stand_anim: 'flpstr', walk_anim: 'flpver', run_anim: 'flphor', pain_anims: 'flppn1,flppn2', death_anims: 'flpdth',
    melee_anim: 'flpbit', melee_frame: 7, melee_range: 80, melee_dmg: 5,        // flipper_bite: 5
    attack_chance: 0, pain_chance: 1,
    sight_snd: 'flipper/flpsght1.wav', idle_snd: 'flipper/flpidle1.wav', search_snd: 'flipper/flpsrch1.wav', pain_snd: 'flipper/flppain1.wav',
    death_snd: 'flipper/flpdeth1.wav', melee_snd: 'flipper/flpbit1.wav',
  },
  {
    name: 'supertank', model: 'models/monsters/boss1/tris.md2', skin: 0, health: 1500, gib_health: -500, mass: 800,
    minx: -64, miny: -64, minz: 0, maxx: 64, maxy: 64, maxz: 112,
    run_speed: 12, walk_speed: 4, yaw_speed: 10,
    anims: [['attak1', 6], ['attak2', 27], ['attak3', 27], ['attak4', 6], ['backwd', 18], ['death', 24], ['forwrd', 18], ['pain1', 4], ['pain2', 4], ['pain3', 4], ['stand', 60]],
    stand_anim: 'stand', walk_anim: 'forwrd', run_anim: 'forwrd', pain_anims: 'pain1,pain2,pain3', death_anims: 'death',
    missile_anim: 'attak1', missile_frames: '0,1,2,3,4,5', missile_kind: 'chaingun', attack_chance: 0.5, pain_chance: 0.5,   // supertank_machinegun: 6 damage a frame
    alt_anim: 'attak2', alt_frames: '7,10,13', alt_kind: 'rocket', alt_chance: 0.7,   // supertank_rocket: three at 50
    sight_snd: 'bosstank/btkunqv1.wav', idle_snd: 'bosstank/btkengn1.wav', search_snd: 'bosstank/btksrch1.wav', pain_snd: 'bosstank/btkpain1.wav',
    death_snd: 'bosstank/btkdeth1.wav', attack_snd: 'tank/rocket.wav',
  },
  {
    name: 'boss2', model: 'models/monsters/boss2/tris.md2', skin: 0, health: 2000, gib_health: -200, mass: 1000, flags: 1,
    minx: -56, miny: -56, minz: 0, maxx: 56, maxy: 56, maxz: 80,
    run_speed: 8, walk_speed: 8, yaw_speed: 10,
    anims: [['stand', 21], ['walk', 20], ['run', 20], ['attack_pre_mg', 9], ['attack_mg', 6], ['attack_post_mg', 8], ['attack_rocket', 6], ['pain_heavy', 18], ['pain_light', 4], ['death', 50]],
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain_heavy,pain_light', death_anims: 'death',
    missile_anim: 'attack_mg', missile_frames: '0,1,2,3,4,5', missile_kind: 'chaingun', attack_chance: 0.5, pain_chance: 0.5,   // Boss2MachineGun: 6 damage a frame
    alt_anim: 'attack_rocket', alt_frames: '1,2,3,4', alt_kind: 'rocket', alt_chance: 0.4,   // Boss2Rocket: four at 50
    sight_snd: 'boss2/bs2srch1.wav', idle_snd: 'boss2/bs2idle1.wav', search_snd: 'boss2/bs2srch1.wav', pain_snd: 'boss2/bs2pain1.wav',
    death_snd: 'boss2/bs2deth1.wav', attack_snd: 'tank/rocket.wav',
  },
  {
    name: 'jorg', model: 'models/monsters/boss3/rider/tris.md2', skin: 0, health: 3000, gib_health: -2000, mass: 1000,
    minx: -80, miny: -80, minz: 0, maxx: 80, maxy: 80, maxz: 140,
    run_speed: 17, walk_speed: 17, yaw_speed: 10,
    anims: [['attack1', 19], ['attack2', 13], ['death', 50], ['pain1', 3], ['pain2', 3], ['pain3', 25], ['stand', 51], ['walk', 25], ['run', 25]],
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain1,pain2,pain3', death_anims: 'death',
    missile_anim: 'attack1', missile_frames: '5,6,7,8,9,10,11,12,13,14,15,16,17', missile_kind: 'chaingun', attack_chance: 0.5, pain_chance: 0.3,   // jorg_firebullet: 6 a frame
    alt_anim: 'attack2', alt_frames: '7', alt_kind: 'bfg', alt_chance: 0.7,   // jorgBFG: 50 damage at 300, 200 radius; Makron rises from its body
    sight_snd: 'boss3/bs3srch1.wav', idle_snd: 'boss3/bs3idle1.wav', search_snd: 'boss3/bs3srch1.wav', pain_snd: 'boss3/bs3pain1.wav',
    death_snd: 'boss3/bs3deth1.wav', attack_snd: 'boss3/xfire.wav',
  },
  {
    name: 'makron', model: 'models/monsters/boss3/jorg/tris.md2', skin: 0, health: 3000, gib_health: -2000, mass: 500,
    minx: -30, miny: -30, minz: 0, maxx: 30, maxy: 30, maxz: 90,
    run_speed: 8, walk_speed: 3, yaw_speed: 10,
    anims: [['attack3', 8], ['attack4', 26], ['attack5', 16], ['death2', 95], ['death3', 20], ['pain4', 4], ['pain5', 4], ['pain6', 27], ['stand', 60], ['walk', 10], ['run', 10], ['sight', 13]],
    stand_anim: 'stand', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain4,pain5,pain6', death_anims: 'death2',
    // Makron_CheckAttack picks the BFG, the railgun or the hyperblaster: the three attacks are chosen in monsters.sql
    missile_anim: 'attack3', missile_frames: '3', missile_kind: 'bfg', attack_chance: 0.5, pain_chance: 0.3,   // MakronBFG: 50 damage at 300, 300 radius
    alt_anim: 'attack4', alt_frames: '7', alt_kind: 'railgun', alt_chance: 0.33,   // MakronRailgun: 50 damage, 100 kick
    sight_snd: 'makron/voice3.wav', idle_snd: 'makron/voice.wav', search_snd: 'makron/voice2.wav', pain_snd: 'makron/pain3.wav',
    death_snd: 'makron/death.wav', attack_snd: 'makron/bfg_fire.wav',
  },
  {
    name: 'insane', model: 'models/monsters/insane/tris.md2', skin: 0, health: 100, gib_health: -50, mass: 300,
    run_speed: 0, walk_speed: 2.5, yaw_speed: 20,
    anims: [['stand', 40], ['stand_pain', 5], ['stand_die', 2], ['stand_insane', 30], ['walk', 20], ['run', 7], ['pain', 5], ['death', 1], ['crawl', 20], ['crawl_pain', 5], ['crawl_death', 2], ['cross', 16], ['struggle', 15], ['cross_death', 2]],
    // the insane marines never attack (m_insane.c has no attack): the standing one raves and, roused, runs about
    // (insane_run); misc_insane's spawnflags pick its form, a type each below (4 CRAWL, 8 CRUCIFIED), skin rand() % 3
    stand_anim: 'stand_insane', walk_anim: 'walk', run_anim: 'run', pain_anims: 'pain,stand_pain', death_anims: 'death,stand_die',
    attack_chance: 0, pain_chance: 1,
    sight_snd: 'insane/insane3.wav', idle_snd: 'insane/insane7.wav', search_snd: 'insane/insane7.wav', pain_snd: 'insane/insane4.wav',
    death_snd: 'insane/insane5.wav',
  },
  {
    // the crawling marine (misc_insane with CRAWL): on its knees for good, its stand, walk and run the crawl frames
    // (insane_move_down, insane_move_crawl, insane_move_runcrawl), the crawl's pain and death
    name: 'insane_crawl', model: 'models/monsters/insane/tris.md2', skin: 0, health: 100, gib_health: -50, mass: 300,
    run_speed: 9, walk_speed: 2, yaw_speed: 20,
    anims: [['stand', 40], ['stand_pain', 5], ['stand_die', 2], ['stand_insane', 30], ['walk', 20], ['run', 7], ['pain', 5], ['death', 1], ['crawl', 20], ['crawl_pain', 5], ['crawl_death', 2], ['cross', 16], ['struggle', 15], ['cross_death', 2]],
    stand_anim: 'crawl', walk_anim: 'crawl', run_anim: 'crawl', pain_anims: 'crawl_pain', death_anims: 'crawl_death',
    attack_chance: 0, pain_chance: 1,
    sight_snd: 'insane/insane3.wav', idle_snd: 'insane/insane7.wav', search_snd: 'insane/insane7.wav', pain_snd: 'insane/insane4.wav',
    death_snd: 'insane/insane5.wav',
  },
  {
    // the crucified marine (misc_insane with CRUCIFIED): on the wall (FL_FLY, a box 8 deep: it never drops or moves,
    // AI_STAND_GROUND), hanging through the cross frames, struggling when hurt (insane_move_struggle_cross), dying on
    // the cross and staying there (insane_dead keeps FL_FLY)
    name: 'insane_cross', model: 'models/monsters/insane/tris.md2', skin: 0, health: 100, gib_health: -50, mass: 300, flags: 1,
    minx: -16, miny: 0, minz: 0, maxx: 16, maxy: 8, maxz: 32,
    run_speed: 0, walk_speed: 0, yaw_speed: 0,
    anims: [['stand', 40], ['stand_pain', 5], ['stand_die', 2], ['stand_insane', 30], ['walk', 20], ['run', 7], ['pain', 5], ['death', 1], ['crawl', 20], ['crawl_pain', 5], ['crawl_death', 2], ['cross', 16], ['struggle', 15], ['cross_death', 2]],
    stand_anim: 'cross', walk_anim: 'cross', run_anim: 'cross', pain_anims: 'struggle', death_anims: 'cross_death',
    attack_chance: 0, pain_chance: 1,
    sight_snd: 'insane/insane3.wav', idle_snd: 'insane/insane7.wav', search_snd: 'insane/insane7.wav', pain_snd: 'insane/insane4.wav',
    death_snd: 'insane/insane5.wav',
  },
];
/**
 * The full game's decorations with a model the demo pak lacks: a model row without a mesh and its frame runs, as the
 * monsters above get, so their logic runs here (the painter skips them). The commander's body (monster_commander_body,
 * g_misc.c): its 24 frames lie still, and sit up when it is used.
 */
export const DECORATIONS = [
  { model: 'models/monsters/commandr/tris.md2', anims: [['sit', 24]], minx: -32, miny: -32, minz: 0, maxx: 32, maxy: 32, maxz: 48 },
];
/** The full game's monsters: those with a frame table of their own (their models are not in the demo pak). */
export const FULL_GAME_MONSTERS = MONSTERS.filter((m) => m.anims).map((m) => m.name);

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
