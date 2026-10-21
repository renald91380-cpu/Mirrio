// Mirrio : boulangerie-pâtisserie de démonstration « Maison Dorée » (données fictives).
// Source unique pour la page de commande (commander.html?p=demo-patisserie) ET le back-office de démo
// (commandes.html?demo=1) : les commandes ci-dessous alimentent à la fois la liste du pâtissier et le
// calendrier de disponibilité côté client (charges, paliers déjà pris), donc les deux écrans restent cohérents.
// Script classique, aucune requête réseau.
(function(){
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function plus(isoDate, n){ var d = new Date(isoDate + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }

  var reglages = {
    activee: true, delai_min_jours: 3, horizon_jours: 120, commandes_max_par_jour: 5,
    surcharge_points: 2, surcharge_pourcentage: 15, surcharge_max_par_jour: 1,
    exception_points: 3, exception_pourcentage: 30, exception_max_par_jour: 1,
    poids_standard: 1, poids_gros: 2, seuil_gros_parts: 25, poids_mariage: 3,
    jours_fermes: [1], heure_retrait_debut: '08:00', heure_retrait_fin: '18:00', acompte_pourcentage: 30, acompte_integral: false,
    adresse_retrait: '12 rue de la République, Lyon 2e', message_accueil: 'Tout est fait maison, la veille ou le matin même du retrait.'
  };

  var produits = [
    { id: 'd1', nom: 'Croquembouche de mariage', categorie: 'Pièces montées et croquembouches', description: 'Choux garnis de crème pâtissière vanille, caramel filé et nougatine, à partir de 20 parts.', prix_part: 4.2, parts_min: 20, parts_max: 120 },
    { id: 'd2', nom: 'Wedding cake trois étages', categorie: 'Gâteaux de fête et layer cakes', description: 'Génoise vanille, ganache montée framboise, finition pâte à sucre.', prix_part: 6.5, parts_min: 25, parts_max: 100 },
    { id: 'd3', nom: 'Fraisier', categorie: 'Entremets', description: 'Génoise, crème mousseline vanille, fraises fraîches et pâte d’amande.', prix_part: 5.2, parts_min: 6, parts_max: 30 },
    { id: 'd4', nom: 'Entremets chocolat noisette', categorie: 'Entremets', description: 'Croustillant praliné, mousse chocolat noir 70 %, glaçage miroir.', prix_part: 5.6, parts_min: 6, parts_max: 30 },
    { id: 'd5', nom: 'Layer cake personnalisé', categorie: 'Gâteaux de fête et layer cakes', description: 'Étages de biscuit et de crème au beurre, message et décor à votre goût.', prix_part: 5.9, parts_min: 8, parts_max: 40 },
    { id: 'd6', nom: 'Plateau de petits fours sucrés', categorie: 'Petits fours et mignardises', description: 'Assortiment de 12 variétés : choux, tartelettes, financiers, mignardises.', prix_part: 3.4, parts_min: 10, parts_max: 80 },
    { id: 'd7', nom: 'Éclairs et religieuses', categorie: 'Pâtisseries individuelles', description: 'Pâte à choux, crème pâtissière café, chocolat ou vanille, glaçage fondant.', prix_part: 3.2, parts_min: 12, parts_max: 120, unite: 'piece' },
    { id: 'd8', nom: 'Macarons assortis', categorie: 'Macarons', description: 'Coques lisses et ganaches : pistache, framboise, caramel beurre salé, chocolat.', prix_part: 1.9, parts_min: 24, parts_max: 200, unite: 'piece' }
  ].map(function(p, i){ p.actif = true; p.position = i; p.photo_url = 'img/gateaux/' + p.id + '.webp'; p.unite = p.unite || 'part'; return p; });

  // Les commandes de démo gardent le catalogue d'origine, même si le catalogue est modifié ensuite dans la démo.
  var base = produits.map(function(p){ return { id: p.id, nom: p.nom, prix_part: p.prix_part }; });
  function produitBase(id){ return base.filter(function(p){ return p.id === id; })[0] || { nom: 'Gâteau', prix_part: 5 }; }
  function prix(idProduit){ return produitBase(idProduit).prix_part; }

  // [jours à partir d'aujourd'hui, produit, occasion, parts, client, statut, extras]
  var SPECS = [
    [6,  'd2', 'mariage',      80, 'Sophie et Karim Benali', 'confirmee', { heure: '10:00', message: 'Sophie & Karim, 27 octobre', note: 'Pâte à sucre ivoire, fleurs séchées.' }],
    [6,  'd3', 'anniversaire',  8, 'Lucas Perrin',           'nouvelle',  { allergies: 'Fruits à coque', message: 'Joyeux anniversaire Lucas !' }],
    [7,  'd4', 'anniversaire', 10, 'Inès Moreau',            'nouvelle',  {}],
    [10, 'd1', 'mariage',      60, 'Famille Rousseau',       'confirmee', { heure: '14:00' }],
    [10, 'd5', 'communion',    30, 'Claire Fontaine',        'nouvelle',  { message: 'Bravo Anaïs' }],
    [13, 'd3', 'anniversaire', 12, 'Mehdi Cherif',           'nouvelle',  {}],
    [13, 'd4', 'retraite',     10, 'Mairie de Villeurbanne', 'confirmee', { message: 'Bonne retraite Monique !' }],
    [14, 'd2', 'mariage',      50, 'Julie et Thomas Garnier', 'confirmee', {}],
    [15, 'd1', 'mariage',      40, 'Nadia Bensaïd',          'confirmee', {}],
    [15, 'd3', 'anniversaire',  6, 'Paul Lambert',           'nouvelle',  {}],
    [17, 'd2', 'mariage',      70, 'Élodie et Marc Vidal',   'confirmee', {}],
    [17, 'd1', 'mariage',      50, 'Famille Diallo',         'confirmee', {}],
    [17, 'd5', 'communion',    30, 'Sandrine Roux',          'confirmee', {}],
    [20, 'd2', 'mariage',      60, 'Amélie et Hugo Faure',   'nouvelle',  {}],
    [22, 'd1', 'mariage',      40, 'Famille Haddad',         'confirmee', {}],
    [22, 'd2', 'mariage',     100, 'Camille et Yanis Roche', 'confirmee', { niveau: 'surcharge' }],
    [24, 'd2', 'mariage',      80, 'Léa et Antoine Mercier', 'confirmee', {}],
    [24, 'd1', 'mariage',      60, 'Famille Costa',          'confirmee', { niveau: 'surcharge' }],
    [24, 'd3', 'anniversaire',  8, 'Dr Aubert',              'confirmee', { niveau: 'exception' }]
  ];

  function commandes(auj){
    var d0 = auj || iso(new Date());
    return SPECS.map(function(s, i){
      var extra = s[6], base = Math.round(s[3] * prix(s[1]) * 100) / 100, pct = extra.niveau === 'exception' ? reglages.exception_pourcentage : (extra.niveau === 'surcharge' ? reglages.surcharge_pourcentage : 0);
      var total = pct ? Math.round(base * (100 + pct)) / 100 : base;
      return {
        id: 'c' + (i + 1), reference: 'MD' + String(1000 + i * 37), produit_id: s[1],
        produit_nom: produitBase(s[1]).nom, occasion: s[2], parts: s[3],
        date_retrait: plus(d0, s[0]), heure_retrait: extra.heure || null, client_nom: s[4],
        client_email: s[4].toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') + '@exemple.fr', client_telephone: '06 12 34 56 7' + (i % 10),
        statut: s[5], prix_estime: total, prix_final: s[5] === 'confirmee' ? total : null, acompte_pourcentage: pct ? 0 : (reglages.acompte_integral ? 100 : reglages.acompte_pourcentage),
        surcharge: !!pct, surcharge_pourcentage: pct || null, niveau_charge: extra.niveau || null,
        paiement_statut: pct ? 'paye' : null, paye_montant: pct ? total : null,
        message_gateau: extra.message || null, allergies: extra.allergies || null, personnalisation: null, note_patissier: extra.note || null
      };
    });
  }

  // Étiquette courte d'une commande pour le message « a déjà … » du calendrier.
  function etiquette(c){ return c.occasion === 'mariage' ? 'mariage' : (c.parts > reglages.seuil_gros_parts ? 'gros gâteau' : c.occasion); }
  function poids(c){ return c.occasion === 'mariage' ? reglages.poids_mariage : (c.parts > reglages.seuil_gros_parts ? reglages.poids_gros : reglages.poids_standard); }

  function agenda(auj){
    var details = {}, charges = {}, niveaux = {};
    commandes(auj).forEach(function(c){
      (details[c.date_retrait] = details[c.date_retrait] || []).push(etiquette(c));
      charges[c.date_retrait] = (charges[c.date_retrait] || 0) + poids(c);
      if(c.niveau_charge){ var n = niveaux[c.date_retrait] = niveaux[c.date_retrait] || { surcharge: 0, exception: 0 }; n[c.niveau_charge]++; }
    });
    return { details: details, charges: charges, niveaux: niveaux };
  }

  // Réglages et catalogue modifiés dans le back-office de démo : gardés le temps de la session.
  var CLE = 'mirrio-demo-patisserie';
  try{
    var sauve = JSON.parse(sessionStorage.getItem(CLE));
    if(sauve){ Object.assign(reglages, sauve.reglages || {}); if(sauve.produits){ produits.length = 0; sauve.produits.forEach(function(p){ produits.push(p); }); } }
  }catch(e){}
  function sauver(){ try{ sessionStorage.setItem(CLE, JSON.stringify({ reglages: reglages, produits: produits })); }catch(e){} }
  function reinitialiser(){ try{ sessionStorage.removeItem(CLE); }catch(e){} }

  // Photos réelles et libres de droits (Wikimedia Commons), hébergées dans img/gateaux/ ; crédits affichés dans la démo.
  var credits = [
    {
      "id": "d1",
      "titre": "Croquembouche wedding cake",
      "auteur": "Eric Baker",
      "licence": "CC BY-SA 3.0",
      "page": "https://commons.wikimedia.org/wiki/File:Croquembouche_wedding_cake.jpg"
    },
    {
      "id": "d2",
      "titre": "Cake at a wedding in Indianapolis - 2006-10-14",
      "auteur": "markjhandel",
      "licence": "CC BY 2.0",
      "page": "https://commons.wikimedia.org/wiki/File:Cake_at_a_wedding_in_Indianapolis_-_2006-10-14.jpg"
    },
    {
      "id": "d3",
      "titre": "France gateau fraisier",
      "auteur": "SUBARUsti2020hk",
      "licence": "CC BY-SA 4.0",
      "page": "https://commons.wikimedia.org/wiki/File:France_gateau_fraisier.jpg"
    },
    {
      "id": "d4",
      "titre": "Chocolate cake in Tokyo",
      "auteur": "Syced",
      "licence": "CC0",
      "page": "https://commons.wikimedia.org/wiki/File:Chocolate_cake_in_Tokyo.jpg"
    },
    {
      "id": "d5",
      "titre": "Three layer gourmet birthday cake",
      "auteur": "Vernice Karbe",
      "licence": "CC BY-SA 4.0",
      "page": "https://commons.wikimedia.org/wiki/File:Three_layer_gourmet_birthday_cake.jpg"
    },
    {
      "id": "d6",
      "titre": "Petit Four Juni 2012",
      "auteur": "4028mdk09",
      "licence": "CC BY-SA 3.0",
      "page": "https://commons.wikimedia.org/wiki/File:Petit_Four_Juni_2012.JPG"
    },
    {
      "id": "d7",
      "titre": "Éclairs et gâteaux",
      "auteur": "Thomon",
      "licence": "CC BY-SA 4.0",
      "page": "https://commons.wikimedia.org/wiki/File:%C3%89clairs_et_g%C3%A2teaux.jpg"
    },
    {
      "id": "d8",
      "titre": "Des macarons de chez Bouillet (mars 2023)",
      "auteur": "Benoît Prieur",
      "licence": "CC0",
      "page": "https://commons.wikimedia.org/wiki/File:Des_macarons_de_chez_Bouillet_(mars_2023).jpg"
    }
  ];

  var groupes = [
    { nom: 'Cérémonies', items: { mariage: 'Mariage', anniversaire_mariage: 'Anniversaire de mariage (noces)', fiancailles: 'Fiançailles', bapteme: 'Baptême', communion: 'Communion', bar_mitsva: 'Bar ou bat-mitsva' } },
    { nom: 'Fêtes personnelles', items: { anniversaire: 'Anniversaire', anniversaire_enfant: 'Anniversaire d’enfant', naissance: 'Naissance, baby shower', gender_reveal: 'Révélation du sexe du bébé', diplome: 'Remise de diplôme', cremaillere: 'Pendaison de crémaillère', reunion_famille: 'Repas de famille ou entre amis' } },
    { nom: 'Vie professionnelle', items: { retraite: 'Départ en retraite', pot_depart: 'Pot de départ ou d’arrivée', entreprise: 'Événement d’entreprise' } },
    { nom: 'Fêtes de l’année', items: { epiphanie: 'Épiphanie (galette des rois)', saint_valentin: 'Saint-Valentin', paques: 'Pâques', fete_parents: 'Fête des mères ou des pères', noel: 'Noël, fêtes de fin d’année', fete_religieuse: 'Fête religieuse (Aïd, Hanouka…)' } },
    { nom: 'Autre', items: { autre: 'Autre (à préciser)' } }
  ];
  var occasions = {}; groupes.forEach(function(g){ Object.keys(g.items).forEach(function(k){ occasions[k] = g.items[k]; }); });

  window.DEMO_PATISSERIE = { credits: credits, groupes: groupes, occasions: occasions, sauver: sauver, reinitialiser: reinitialiser, nom: 'Maison Dorée (démo)', ville: 'Lyon', reglages: reglages, produits: produits, commandes: commandes, agenda: agenda, plus: plus, iso: iso };
})();
