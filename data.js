const TILES_OPEN = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
];

const GAME = {
  maps: {
    map1: {
      name: "vallée",
      cols: 15,
      rows: 10,
      tiles: TILES_OPEN,
      edgesWalls: [],
      startZones: {
        A: [[0,3],[1,3],[2,3],[0,4],[1,4],[2,4],[0,5],[1,5],[2,5],[0,6],[1,6],[2,6]],
        B: [[14,3],[13,3],[12,3],[14,4],[13,4],[12,4],[14,5],[13,5],[12,5],[14,6],[13,6],[12,6]]
      },
      objectives: {
        A: { x: 2, y: 4, hp: 20 },
        B: { x: 12, y: 4, hp: 20 }
      },
      fireCells: [],
      healCells: [],
      speedCells: [],
      voidCells: []
    },
    map2: {
      name: "Terrain 2",
      cols: 15,
      rows: 10,
      tiles: TILES_OPEN,
      edgesWalls: [],
      startZones: {
        A: [[0,3],[1,3],[2,3],[0,4],[1,4],[2,4],[0,5],[1,5],[2,5],[0,6],[1,6],[2,6]],
        B: [[14,3],[13,3],[12,3],[14,4],[13,4],[12,4],[14,5],[13,5],[12,5],[14,6],[13,6],[12,6]]
      },
      objectives: {
        A: { x: 2, y: 4, hp: 20 },
        B: { x: 12, y: 4, hp: 20 }
      },
      fireCells: [],
      healCells: [],
      speedCells: [],
      voidCells: []
    }
  },
  activeMap: "map1",
  characters: [
    {
      id: "ark",
      name: "ARK",
      number: 3,
      role: "colosse",
      hp: 14,
      atk: 3,
      mouvement: 2,
      range: 2,
      ability: {
        name: "Mur",
        desc: "Cd 5 — Érige UN mur de bordure sur le côté de son choix autour de sa case (case directement adjacente). Il bloque la vision, les déplacements et les attaques."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "fakie",
      name: "Fakie",
      number: 14,
      role: "expert",
      hp: 10,
      atk: 3,
      mouvement: 3,
      range: 3,
      ability: {
        name: "Permutation",
        desc: "Cd 6 — Échange sa position avec n'importe quel champion adverse sur le terrain : l'adversaire subit 2 dégâts. Cette capacité ignore les murs."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "koga",
      name: "KOGA",
      number: 12,
      role: "assassin",
      hp: 11,
      atk: 3,
      mouvement: 4,
      range: 2,
      ability: {
        name: "Saccage",
        desc: "Cd 0 — À chaque attaque, KOGA récupère 1 PV. À son élimination, il laisse sur sa case de mort une case spéciale au hasard : case vide (impassable), case soin (+1 PV au passage) ou case en feu (1 dégât au passage)."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "jay",
      name: "JAY",
      number: 9,
      role: "soutien",
      hp: 9,
      atk: 2,
      mouvement: 3,
      range: 2,
      ability: {
        name: "Aura de soin",
        desc: "Cd 3 — Jay active son aura pour 8 tours : chaque allié dans un rayon de 2 cases autour de lui (diagonales incluses) récupère 1 PV au début de chaque tour. Jay ne se soigne pas lui-même. Quand les 8 tours s'achèvent, la capacité part en recharge (Cd 3)."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "braut",
      name: "BRAUT",
      number: 4,
      role: "ravageur",
      hp: 11,
      atk: 5,
      mouvement: 3,
      range: 1,
      ability: {
        name: "Frappe dévastatrice",
        desc: "Cd 5 — Sa prochaine attaque inflige 7 dégâts contre un champion de rôle Colosse, ou 6 dégâts contre les autres champions."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "scrab",
      name: "SCRAB",
      number: 11,
      role: "assassin",
      hp: 8,
      atk: 3,
      mouvement: 5,
      range: 2,
      ability: {
        name: "Gel",
        desc: "Cd 3 — Gel : gèle UN champion adverse choisi dans la zone carrée 7×7 centrée sur SCRAB (les murs sont ignorés). Le champion gelé ne peut PAS être utilisé pendant tout le prochain tour adverse."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "ad",
      name: "A.D.",
      number: 7,
      role: "soutien",
      hp: 9,
      atk: 2,
      mouvement: 5,
      range: 3,
      ability: {
        name: "Soin",
        desc: "Cd 5 — Soigne un allié de 4 PV, sur une ligne horizontale ou verticale uniquement (aucune diagonale), jusqu'à 4 cases. Le soin ne traverse pas les murs."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "betta",
      name: "BETTA",
      number: 8,
      role: "soutien",
      hp: 8,
      atk: 2,
      mouvement: 5,
      range: 2,
      ability: {
        name: "Enchantement",
        desc: "Cd 0 — Place une balise de soin sur un allié situé sur une ligne horizontale ou verticale (aucune diagonale), à 2 cases max, avec ligne de vue dégagée : il récupère 1 PV au début de chacun de ses tours pendant 8 manches (1 manche = les 2 joueurs ont joué). Au terme des 8 manches, l'enchantement s'arrête et BETTA récupère son enchantement pour le rejouer. Si la cible est éliminée avant ces 8 manches, l'enchantement est perdu définitivement et BETTA ne récupère pas cette charge. Limite : 2 enchantements."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "abyss",
      name: "ABYSS",
      number: 1,
      role: "colosse",
      hp: 13,
      atk: 4,
      mouvement: 2,
      range: 1,
      ability: {
        name: "Solidification",
        desc: "Cd 6 — Réduit de moitié les dégâts de la prochaine attaque reçue, arrondis à l'inférieur. Le Cd commence dès l'activation, même si l'effet n'a pas encore été déclenché."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "cazou",
      name: "CAZOU",
      number: 13,
      role: "expert",
      hp: 11,
      atk: 3,
      mouvement: 3,
      range: 1,
      ability: {
        name: "Manipulation",
        desc: "Cd 6 — Sacrifie 4 PV (peut l'éliminer) et manipule un seul champion adverse : cliquez d'abord le champion concerné, puis la case libre du plateau où le porter."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "prince",
      name: "PRINCE",
      number: 15,
      role: "expert",
      hp: 10,
      atk: 3,
      mouvement: 4,
      range: 2,
      ability: {
        name: "Purple Rain",
        desc: "Cd 7 — Une pluie violette s'abat : plus aucun champion sur le terrain ne peut être soigné, ni par une capacité (A.D., MOM'S, JAY, BETTA, KOGA), ni par une case de soin. L'effet s'arrête dès qu'un champion est éliminé. Le temps de recharge (7) ne commence qu'à la fin de la pluie, donc après la première élimination. Les dégâts du poison et du feu ne sont pas affectés."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "dicrum",
      name: "DICRUM",
      number: 10,
      role: "assassin",
      hp: 9,
      atk: 3,
      mouvement: 4,
      range: 2,
      ability: {
        name: "Tir précis",
        desc: "Cd 6 — Inflige 8 dégâts à un ennemi situé exactement à 5 cases horizontalement ou verticalement (jamais en diagonale). Sa ligne de vue doit être dégagée."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "vini",
      name: "VINI",
      number: 5,
      role: "ravageur",
      hp: 10,
      atk: 4,
      mouvement: 3,
      range: 1,
      ability: {
        name: "Reflet",
        desc: "Cd 5 — La prochaine attaque reçue inflige ses dégâts normalement à Vini, puis inflige exactement les mêmes dégâts à l'attaquant."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "guard",
      name: "GUARD",
      number: 2,
      role: "colosse",
      hp: 14,
      atk: 4,
      mouvement: 2,
      range: 1,
      ability: {
        name: "Dôme de Verre",
        desc: "Cd 5 — Crée pendant 3 manches complètes une zone impénétrable de 3×3 cases (centrée sur lui). Elle bloque les déplacements (de ceux qui sont dedans et de ceux qui voudraient y entrer) et toutes les attaques. GUARD ne peut plus se déplacer tant que la zone est active."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "rapido",
      name: "Rapido",
      number: 6,
      role: "ravageur",
      hp: 10,
      atk: 3,
      mouvement: 3,
      range: 2,
      ability: {
        name: "Déferlement",
        desc: "Cd 6 — RAPIDO attaque deux fois dans le même tour : chaque attaque inflige 3 dégâts, que ce soit sur un champion ou sur un objectif. Il doit lancer Déferlement avant tout déplacement. La 1ère attaque peut être portée après déplacement ou non ; entre les deux il peut de nouveau se déplacer, puis porter une 2ème attaque (même cible ou non), qui paralyse la cible pendant un tour."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "calix",
      name: "CALIX",
      number: 19,
      role: "expert",
      hp: 11,
      atk: 3,
      mouvement: 4,
      range: 2,
      ability: {
        name: "Création",
        desc: "Cd 4 — Pose UNE case spéciale à sa portée (ligne droite uniquement, aucune diagonale) sur une case libre du terrain (vide, feu, soin ou vitesse). Quota maximum simultané : 1 vide, 2 feux, 1 soin, 1 vitesse. Si CALIX est éliminé, toutes ses cases sont retirées du terrain."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "ranium",
      name: "RANIUM",
      number: 18,
      role: "assassin",
      hp: 8,
      atk: 3,
      mouvement: 3,
      range: 1,
      ability: {
        name: "Empoisonnement",
        desc: "Cd 4 — Empoisonne un champion adverse : il perd 1 PV par couche de poison au début de chacun de ses tours. Les poisons s'additionnent (1 couche = 1 dégât/tour, 2 couches = 2 dégâts/tour). Le poison reste même si RANIUM est éliminé, et il est dissipé dès que la cible reçoit des PV : le compteur de couches repart alors de zéro."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "moms",
      name: "MOM'S",
      number: 17,
      role: "soutien",
      hp: 13,
      atk: 2,
      mouvement: 2,
      range: 2,
      ability: {
        name: "Transfusion",
        desc: "Cd 4 — MOM'S cède jusqu'à 8 de ses propres PV à un allié blessé situé à 2 cases max. Une fenêtre s'ouvre pour choisir la quantité (1 à 8 PV). Elle ne peut rien céder si elle n'a plus aucun PV, et l'allié ne peut pas dépasser ses PV maximum."
      },
      passive: {
        name: "Régénération",
        desc: "Si MOM'S a moins de 10 PV et que TOUS ses alliés encore sur le terrain sont à leurs PV maximum, elle récupère 1 PV au début de chaque tour de son équipe. Elle ne se régénère jamais au-delà de 10 PV."
      }
    },
    {
      id: "se7en",
      name: "Se7en",
      number: 16,
      role: "ravageur",
      hp: 11,
      atk: 4,
      mouvement: 3,
      range: 1,
      ability: {
        name: "Le Dé",
        desc: "Cd 4 — Lance un dé à 6 faces (le Cd démarre dans tous les cas). 1 : il perd 2 PV. 2 : il perd 1 PV. 3 ou 4 : il porte une attaque normale (4 dégâts) à portée 2. 5 : 6 dégâts à portée 2. 6 : 7 dégâts à portée 2. 1 chance sur 100 : un 7 écrase le dé et inflige 30 dégâts à portée 2 (les dégâts normales, soit 4, s'il vise l'objectif adverse)."
      },
      passive: { name: "", desc: "" }
    },
    {
      id: "xixz",
      name: "XIXZ",
      number: 20,
      role: "colosse",
      hp: 12,
      atk: 3,
      mouvement: 3,
      range: 2,
      ability: {
        name: "Pacif",
        desc: "Passif permanent (aucun Cd) - Une aura de 3×3 cases centrée sur XIXZ se déplace avec lui. Tous ses champions alliés dans cette zone (XIXZ inclus) subissent 1 dégât de moins par attaque reçue (3 dégâts deviennent 2 ; une attaque de 1 dégât est totalement absorbée). Ne s'applique ni au poison ni au feu du terrain."
      },
      passive: { name: "", desc: "" }
    }
  ]
};

function setActiveMap(name) {
  const m = GAME.maps[name];
  if (!m) return;
  GAME.activeMap = name;
  GAME.map = m;
  GAME.startZones = m.startZones;
  GAME.objectives = m.objectives;
  GAME.fireCells = m.fireCells;
  GAME.edgeSet = new Set(m.edgesWalls);
}

setActiveMap(GAME.activeMap);