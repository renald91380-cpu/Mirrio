/* Cadence - mode démo (script classique, chargé AVANT les scripts des pages).
 *
 * Il ne s'active que pour trois salons fictifs (demo-barber, demo-coiffure, demo-institut)
 * et pour l'annuaire appelé avec ?demo=1. Il simule l'API (/api/vitrine, /api/annuaire,
 * /api/reservation-disponibilites, /api/reservation-publique) avec les MÊMES règles que le
 * serveur : personne éligible, horaires, chevauchements, confirmation immédiate, acompte.
 * Rien n'est envoyé ni enregistré ailleurs que dans sessionStorage (réinitialisable).
 *
 * Les slugs « demo-* » sont interdits aux vrais salons (contrainte SQL schema-v20).
 */
(function(){
  'use strict';
  var params = new URLSearchParams(location.search);
  var slug = params.get('p') || '';
  var estAnnuaire = /explorer\.html$/.test(location.pathname) && params.get('demo') === '1';

  // ------------------------------------------------------------------ photos
  // Photos libres de droits (Wikimedia Commons). CC0 : aucune obligation ; CC BY / BY-SA :
  // crédits affichés sur demo.html. À remplacer par les photos du salon réel.
  var PHOTOS = {"Beauty salons in iran 07.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/82/Beauty_salons_in_iran_07.jpg/1280px-Beauty_salons_in_iran_07.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/82/Beauty_salons_in_iran_07.jpg/960px-Beauty_salons_in_iran_07.jpg", "lic": "CC0", "aut": "Mostafameraji", "page": "https://commons.wikimedia.org/wiki/File:Beauty_salons_in_iran_07.jpg"}, "Beauty salons in iran 08.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/98/Beauty_salons_in_iran_08.jpg/1280px-Beauty_salons_in_iran_08.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/98/Beauty_salons_in_iran_08.jpg/960px-Beauty_salons_in_iran_08.jpg", "lic": "CC0", "aut": "Mostafameraji", "page": "https://commons.wikimedia.org/wiki/File:Beauty_salons_in_iran_08.jpg"}, "Beauty salons in iran 05.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/79/Beauty_salons_in_iran_05.jpg/1280px-Beauty_salons_in_iran_05.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/79/Beauty_salons_in_iran_05.jpg/960px-Beauty_salons_in_iran_05.jpg", "lic": "CC0", "aut": "Mostafameraji", "page": "https://commons.wikimedia.org/wiki/File:Beauty_salons_in_iran_05.jpg"}, "Beauty salons in iran 10.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/Beauty_salons_in_iran_10.jpg/1280px-Beauty_salons_in_iran_10.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/Beauty_salons_in_iran_10.jpg/960px-Beauty_salons_in_iran_10.jpg", "lic": "CC0", "aut": "Mostafameraji", "page": "https://commons.wikimedia.org/wiki/File:Beauty_salons_in_iran_10.jpg"}, "Beauty salons in iran 02.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/Beauty_salons_in_iran_02.jpg/1280px-Beauty_salons_in_iran_02.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/Beauty_salons_in_iran_02.jpg/960px-Beauty_salons_in_iran_02.jpg", "lic": "CC0", "aut": "Mostafameraji", "page": "https://commons.wikimedia.org/wiki/File:Beauty_salons_in_iran_02.jpg"}, "Beauty salons in iran 03.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/Beauty_salons_in_iran_03.jpg/1280px-Beauty_salons_in_iran_03.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/Beauty_salons_in_iran_03.jpg/960px-Beauty_salons_in_iran_03.jpg", "lic": "CC0", "aut": "Mostafameraji", "page": "https://commons.wikimedia.org/wiki/File:Beauty_salons_in_iran_03.jpg"}, "Beauty salons in iran.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4f/Beauty_salons_in_iran.jpg/1280px-Beauty_salons_in_iran.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4f/Beauty_salons_in_iran.jpg/960px-Beauty_salons_in_iran.jpg", "lic": "CC0", "aut": "Mostafameraji", "page": "https://commons.wikimedia.org/wiki/File:Beauty_salons_in_iran.jpg"}, "Ricky Reyes salon interiorB.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/Ricky_Reyes_salon_interiorB.jpg/1280px-Ricky_Reyes_salon_interiorB.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/Ricky_Reyes_salon_interiorB.jpg/960px-Ricky_Reyes_salon_interiorB.jpg", "lic": "CC BY-SA 4.0", "aut": "Auteur inconnu", "page": "https://commons.wikimedia.org/wiki/File:Ricky_Reyes_salon_interiorB.jpg"}, "Drying hair in salon.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Drying_hair_in_salon.jpg/1280px-Drying_hair_in_salon.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Drying_hair_in_salon.jpg/960px-Drying_hair_in_salon.jpg", "lic": "CC BY 2.0", "aut": "bradleypjohnson", "page": "https://commons.wikimedia.org/wiki/File:Drying_hair_in_salon.jpg"}, "Salon interior.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/34/Salon_interior.jpg/1280px-Salon_interior.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/34/Salon_interior.jpg/960px-Salon_interior.jpg", "lic": "CC BY 2.0", "aut": "The original uploader was Wikidenizen at English Wikipedia.", "page": "https://commons.wikimedia.org/wiki/File:Salon_interior.jpg"}, "Woman Weaves Hair in Salon 03.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/21/Woman_Weaves_Hair_in_Salon_03.jpg/1280px-Woman_Weaves_Hair_in_Salon_03.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/21/Woman_Weaves_Hair_in_Salon_03.jpg/960px-Woman_Weaves_Hair_in_Salon_03.jpg", "lic": "CC BY-SA 4.0", "aut": "Michael Kalimukwa", "page": "https://commons.wikimedia.org/wiki/File:Woman_Weaves_Hair_in_Salon_03.jpg"}, "Young men with trendy haircut at barber shop.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9b/Young_men_with_trendy_haircut_at_barber_shop.jpg/1280px-Young_men_with_trendy_haircut_at_barber_shop.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9b/Young_men_with_trendy_haircut_at_barber_shop.jpg/960px-Young_men_with_trendy_haircut_at_barber_shop.jpg", "lic": "CC BY 2.0", "aut": "Nenad Stojkovic", "page": "https://commons.wikimedia.org/wiki/File:Young_men_with_trendy_haircut_at_barber_shop.jpg"}, "Routine Facial Treatment And Care.jpg": {"c": "https://upload.wikimedia.org/wikipedia/commons/9/98/Routine_Facial_Treatment_And_Care.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/98/Routine_Facial_Treatment_And_Care.jpg/960px-Routine_Facial_Treatment_And_Care.jpg", "lic": "CC BY-SA 4.0", "aut": "Davidbrenna.artist", "page": "https://commons.wikimedia.org/wiki/File:Routine_Facial_Treatment_And_Care.jpg"}, "SPA SKIN CARE.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d8/SPA_SKIN_CARE.jpg/1280px-SPA_SKIN_CARE.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d8/SPA_SKIN_CARE.jpg/960px-SPA_SKIN_CARE.jpg", "lic": "CC0", "aut": "Keyfwellness", "page": "https://commons.wikimedia.org/wiki/File:SPA_SKIN_CARE.jpg"}, "Emotions spa and Lounge 2.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/39/Emotions_spa_and_Lounge_2.jpg/1280px-Emotions_spa_and_Lounge_2.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/39/Emotions_spa_and_Lounge_2.jpg/960px-Emotions_spa_and_Lounge_2.jpg", "lic": "CC BY-SA 4.0", "aut": "Kyakwera", "page": "https://commons.wikimedia.org/wiki/File:Emotions_spa_and_Lounge_2.jpg"}, "Spa interiors - 1.jpg": {"c": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2a/Spa_interiors_-_1.jpg/1280px-Spa_interiors_-_1.jpg", "g": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2a/Spa_interiors_-_1.jpg/960px-Spa_interiors_-_1.jpg", "lic": "CC BY-SA 3.0", "aut": "Avilash behera", "page": "https://commons.wikimedia.org/wiki/File:Spa_interiors_-_1.jpg"}};
  var c = function(t){ return PHOTOS[t].c; }, g = function(t){ return PHOTOS[t].g; };

  var B = 'Beauty salons in iran';
  var DEMOS = {
    'demo-barber': {
      nom: 'The Barber Club', metier: 'barbier', ville: 'Lyon 1er', accent: 'ambre',
      adresse: '14 rue des Capucins, 69001 Lyon', latitude: 45.7676, longitude: 4.8335,
      jours: [2,3,4,5,6], debut: '09:00', fin: '19:00', pas: 30,
      style: { accroche: 'Coupe, barbe et rasage à l\'ancienne. Sur rendez-vous, sans attente.', mise_en_page: 'immersif', police: 'moderne', couleur: '#FF6B35', fond: 'sombre', boutons: 'carre',
        texte_bouton: 'Réserver mon fauteuil', cover_url: c(B + ' 07.jpg'),
        galerie: [g(B + ' 08.jpg'), g(B + ' 05.jpg'), g(B + ' 10.jpg'), g(B + ' 02.jpg'), g(B + ' 03.jpg'), g(B + '.jpg')],
        a_propos: 'Trois fauteuils, une règle : le temps qu\'il faut pour une coupe nette, une barbe tracée au cordeau et un rasage à la serviette chaude.\n\nOn travaille uniquement sur rendez-vous pour ne jamais vous faire attendre. Choisissez votre barbier, ou laissez-nous vous donner le premier disponible.',
        instagram: '@thebarberclub.lyon', telephone_public: '04 78 00 00 00',
        bandeau_actif: true, bandeau_texte: 'Nouveau : le jeudi, nocturne jusqu\'à 21h sur rendez-vous.' },
      paiement: { en_ligne: true, especes: true, acompte_minimum: 5, acompte_pourcentage: 0 },
      equipe: [
        { id: 'b-karim', nom: 'Karim', role: 'Barbier fondateur', bio: '12 ans de métier, spécialiste du rasage traditionnel.', presta: ['coupe','degrade','enfant','taille','rasage','formule','premium','soin'] },
        { id: 'b-leo', nom: 'Léo', role: 'Dégradés et coupes tendance', bio: 'Skin fade, contours nets, coupes courtes.', presta: ['coupe','degrade','enfant','taille','formule'] },
        { id: 'b-samir', nom: 'Samir', role: 'Barbe et soins', bio: 'Taille de barbe, rasage, soins du visage.', presta: ['taille','rasage','soin','coloration'], jours: [3,4,5,6], debut: '10:00', fin: '19:00' }
      ],
      prestations: [
        { id: 'coupe', categorie: 'Coupe', libelle: 'Coupe homme', prix: 28, duree: 30 },
        { id: 'degrade', categorie: 'Coupe', libelle: 'Dégradé / skin fade', prix: 32, duree: 40 },
        { id: 'enfant', categorie: 'Coupe', libelle: 'Coupe enfant (moins de 12 ans)', prix: 20, duree: 25 },
        { id: 'taille', categorie: 'Barbe', libelle: 'Taille de barbe et contours', prix: 18, duree: 20 },
        { id: 'rasage', categorie: 'Barbe', libelle: 'Rasage traditionnel, serviette chaude', prix: 30, duree: 30 },
        { id: 'formule', categorie: 'Formules', libelle: 'Coupe + barbe', prix: 42, duree: 50 },
        { id: 'premium', categorie: 'Formules', libelle: 'Coupe + barbe + soin visage', prix: 62, duree: 75 },
        { id: 'soin', categorie: 'Soins', libelle: 'Soin visage homme', prix: 35, duree: 30 },
        { id: 'coloration', categorie: 'Soins', libelle: 'Coloration barbe ou cheveux', prix: 30, duree: 40 }
      ].map(function(p){ p.public = 'homme'; return p; }),
      avis: [
        ['Mehdi', 5, 'Le meilleur dégradé de Lyon, et je n\'attends jamais. Réservation en 20 secondes.'],
        ['Thomas', 5, 'Rasage à la serviette chaude, un vrai moment. Karim est un artiste.'],
        ['Julien', 4, 'Super ambiance, coupe impeccable. J\'ai pris l\'acompte de 5 € sans souci.'],
        ['Antoine', 5, 'Léo a compris ce que je voulais du premier coup.'],
        ['Hugo', 5, 'Je viens avec mon fils, ils sont patients et soignés.'],
        ['Nabil', 4, 'Très bon accueil, la barbe est tracée au millimètre.'],
        ['Romain', 5, 'Enfin un barbier où l\'on peut choisir son barbier en ligne.'],
        ['Yanis', 5, 'Rapport qualité prix excellent, je recommande.']
      ]
    },

    'demo-coiffure': {
      nom: 'Maison Éloïse', metier: 'coiffure', ville: 'Paris 11e', accent: 'rose',
      adresse: '27 rue Oberkampf, 75011 Paris', latitude: 48.8650, longitude: 2.3790,
      jours: [2,3,4,5,6], debut: '09:30', fin: '19:00', pas: 30,
      style: { accroche: 'Coiffure femme et homme. Colorations végétales, balayages sur mesure.', mise_en_page: 'classique', police: 'elegante', couleur: '#C25B7E', fond: 'creme', boutons: 'pilule',
        texte_bouton: 'Prendre rendez-vous', cover_url: c('Ricky Reyes salon interiorB.jpg'),
        galerie: [g('Drying hair in salon.jpg'), g('Salon interior.jpg'), g('Woman Weaves Hair in Salon 03.jpg'), g('Young men with trendy haircut at barber shop.jpg')],
        a_propos: 'Un salon lumineux au cœur de la rue Oberkampf, où l\'on prend le temps d\'écouter avant de couper.\n\nColorations sans ammoniaque, balayages à la main, coupes femme et homme. Votre rendez-vous est confirmé immédiatement dès que le créneau est libre.',
        instagram: '@maisoneloise', telephone_public: '01 40 00 00 00', email_public: 'bonjour@maison-eloise.fr' },
      paiement: { en_ligne: false, especes: true, acompte_minimum: 0, acompte_pourcentage: 0 },
      equipe: [
        { id: 'c-eloise', nom: 'Éloïse', role: 'Coloriste, fondatrice', bio: 'Balayages et colorations végétales.', presta: ['coupef','brushing','coloration','balayage','soin','chignon'] },
        { id: 'c-ines', nom: 'Inès', role: 'Coiffeuse', bio: 'Coupes, brushings et coiffures de cérémonie.', presta: ['coupef','brushing','coupeh','soin','chignon'] },
        { id: 'c-marc', nom: 'Marc', role: 'Coiffeur', bio: 'Coupes homme et enfants.', presta: ['coupeh','coupeenfant','coupef'], jours: [2,3,4,5,6], debut: '10:00', fin: '18:00' }
      ],
      prestations: [
        { id: 'coupef', categorie: 'Coupe', libelle: 'Coupe femme', prix: 42, duree: 45, public: 'femme' },
        { id: 'coupeh', categorie: 'Coupe', libelle: 'Coupe homme', prix: 28, duree: 30, public: 'homme' },
        { id: 'coupeenfant', categorie: 'Coupe', libelle: 'Coupe enfant', prix: 18, duree: 25, public: 'mixte' },
        { id: 'brushing', categorie: 'Coiffage', libelle: 'Shampoing, brushing', prix: 32, duree: 40, public: 'femme' },
        { id: 'chignon', categorie: 'Coiffage', libelle: 'Chignon, coiffure de cérémonie', prix: 65, duree: 60, public: 'femme' },
        { id: 'coloration', categorie: 'Couleur', libelle: 'Coloration racines', prix: 58, duree: 90, public: 'femme' },
        { id: 'balayage', categorie: 'Couleur', libelle: 'Balayage sur mesure', prix: 125, duree: 150, public: 'femme' },
        { id: 'soin', categorie: 'Soins', libelle: 'Soin profond', prix: 22, duree: 20, public: 'mixte' }
      ],
      avis: [
        ['Camille', 5, 'Mon balayage est exactement ce dont je rêvais. Éloïse écoute vraiment.'],
        ['Sophie', 5, 'Rendez-vous confirmé tout de suite, ça change la vie. Et l\'équipe est adorable.'],
        ['Léa', 5, 'Chignon de mariage parfait, tenu toute la journée.'],
        ['Paul', 4, 'Coupe homme rapide et soignée avec Marc.'],
        ['Claire', 5, 'Salon magnifique et couleur végétale qui tient très bien.']
      ]
    },

    'demo-institut': {
      nom: 'Institut Lotus', metier: 'esthetique', ville: 'Bordeaux', accent: 'foret',
      adresse: '8 cours de l\'Intendance, 33000 Bordeaux', latitude: 44.8420, longitude: -0.5750,
      jours: [1,2,3,4,5,6], debut: '09:00', fin: '19:00', pas: 30,
      style: { accroche: 'Soins du visage, épilations, mains et pieds, massages. Un moment pour vous.', mise_en_page: 'minimal', police: 'douce', couleur: '#3E7C74', fond: 'clair', boutons: 'arrondi',
        texte_bouton: 'Réserver un soin', cover_url: c('Routine Facial Treatment And Care.jpg'),
        galerie: [g('SPA SKIN CARE.jpg'), g('Emotions spa and Lounge 2.jpg'), g('Spa interiors - 1.jpg')],
        a_propos: 'Une parenthèse douce en plein centre de Bordeaux. Des soins personnalisés réalisés par des professionnelles diplômées, avec des produits choisis pour leur efficacité.\n\nPour garantir votre créneau, un règlement par carte est demandé à la réservation.',
        instagram: '@institutlotus.bordeaux', telephone_public: '05 56 00 00 00' },
      paiement: { en_ligne: true, especes: false, acompte_minimum: 5, acompte_pourcentage: 0 },
      equipe: [
        { id: 'i-sofia', nom: 'Sofia', role: 'Esthéticienne', bio: 'Soins du visage et épilations.', presta: ['visage','visagehydra','epilsourcils','epiljambes','maillot'] },
        { id: 'i-camille', nom: 'Camille', role: 'Prothésiste ongulaire', bio: 'Beauté des mains et des pieds, semi-permanent.', presta: ['mains','pieds','semi'] },
        { id: 'i-nadia', nom: 'Nadia', role: 'Praticienne massage', bio: 'Massages relaxants et sportifs.', presta: ['massage30','massage60','massage90'], jours: [2,3,4,5,6] }
      ],
      prestations: [
        { id: 'visage', categorie: 'Soins du visage', libelle: 'Nettoyage de peau', prix: 55, duree: 60, public: 'mixte' },
        { id: 'visagehydra', categorie: 'Soins du visage', libelle: 'Soin hydratant éclat', prix: 65, duree: 60, public: 'femme' },
        { id: 'epilsourcils', categorie: 'Épilation', libelle: 'Sourcils', prix: 14, duree: 15, public: 'femme' },
        { id: 'epiljambes', categorie: 'Épilation', libelle: 'Jambes complètes', prix: 32, duree: 35, public: 'femme' },
        { id: 'maillot', categorie: 'Épilation', libelle: 'Maillot', prix: 22, duree: 20, public: 'femme' },
        { id: 'mains', categorie: 'Mains et pieds', libelle: 'Beauté des mains', prix: 36, duree: 40, public: 'mixte' },
        { id: 'pieds', categorie: 'Mains et pieds', libelle: 'Beauté des pieds', prix: 44, duree: 45, public: 'mixte' },
        { id: 'semi', categorie: 'Mains et pieds', libelle: 'Pose semi-permanent', prix: 38, duree: 45, public: 'femme' },
        { id: 'massage30', categorie: 'Massages', libelle: 'Massage relaxant, 30 min', prix: 45, duree: 30, public: 'mixte' },
        { id: 'massage60', categorie: 'Massages', libelle: 'Massage relaxant, 60 min', prix: 75, duree: 60, public: 'mixte' },
        { id: 'massage90', categorie: 'Massages', libelle: 'Massage relaxant, 90 min', prix: 105, duree: 90, public: 'mixte' }
      ],
      avis: [
        ['Amandine', 5, 'Un moment hors du temps. Le soin du visage est une merveille.'],
        ['Élodie', 5, 'Réservation facile, paiement sécurisé, accueil au top.'],
        ['Marion', 4, 'Massage très relaxant, je reviendrai.'],
        ['Karine', 5, 'Camille fait des mains magnifiques.']
      ]
    }
  };

  var salon = DEMOS[slug];
  if(!salon && !estAnnuaire) return;

  // ------------------------------------------------------------ utilitaires
  var DEMO_CLE = 'cadence-demo-rdv';
  function lire(){ try{ return JSON.parse(sessionStorage.getItem(DEMO_CLE) || '[]'); }catch(e){ return []; } }
  function ecrire(l){ try{ sessionStorage.setItem(DEMO_CLE, JSON.stringify(l)); }catch(e){} }
  function hash(s){ var h = 2166136261; for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed){ var t = seed >>> 0; return function(){ t += 0x6D2B79F5; var r = Math.imul(t ^ t >>> 15, 1 | t); r ^= r + Math.imul(r ^ r >>> 7, 61 | r); return ((r ^ r >>> 14) >>> 0) / 4294967296; }; }
  var minutes = function(t){ var p = String(t).split(':').map(Number); return p[0] * 60 + (p[1] || 0); };
  function decalage(date){
    var p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).forEach(function(x){ p[x.type] = x.value; });
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime()) / 60000);
  }
  function parisVersUtc(a, m, j, h, mi){ var ap = new Date(Date.UTC(a, m - 1, j, h, mi)); return new Date(ap.getTime() - decalage(ap) * 60000); }
  function composants(date){
    var p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(date).forEach(function(x){ p[x.type] = x.value; });
    return { annee: +p.year, mois: +p.month, jour: +p.day, heure: +p.hour, minute: +p.minute };
  }
  function reponse(corps, statut){ return new Response(JSON.stringify(corps), { status: statut || 200, headers: { 'Content-Type': 'application/json' } }); }
  var wait = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

  // ------------------------------------------------------ règles de disponibilité
  // Même logique que api/_dispo.js : éligibles = assurent TOUTES les prestations choisies ;
  // créneau libre si au moins une personne éligible est ouverte et sans chevauchement.
  function eligibles(s, ids){ return s.equipe.filter(function(i){ return ids.every(function(id){ return i.presta.indexOf(id) >= 0; }); }); }
  function plage(s, i, jourSem){
    var jours = i.jours || s.jours; if(jours.indexOf(jourSem) < 0) return null;
    return { d: minutes(i.debut || s.debut), f: minutes(i.fin || s.fin) };
  }
  // Rendez-vous « déjà pris » fictifs, déterministes par personne et par jour (+ ceux réservés dans cette démo).
  function occupes(s, i, dateStr){
    var r = rng(hash(s.nom + i.id + dateStr)), m = /(\d+)-(\d+)-(\d+)/.exec(dateStr), out = [];
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), pl = plage(s, i, d.getUTCDay());
    if(pl){
      var n = 3 + Math.floor(r() * 4);
      for(var k = 0; k < n; k++){
        var debut = pl.d + Math.floor(r() * ((pl.f - pl.d) / 30)) * 30, dur = 30 + Math.floor(r() * 3) * 30;
        out.push({ a: parisVersUtc(+m[1], +m[2], +m[3], Math.floor(debut / 60), debut % 60).getTime(), b: parisVersUtc(+m[1], +m[2], +m[3], Math.floor((debut + dur) / 60), (debut + dur) % 60).getTime() });
      }
    }
    lire().filter(function(x){ return x.slug === slug && x.interv === i.id; }).forEach(function(x){ out.push({ a: x.a, b: x.b }); });
    return out;
  }
  function creneaux(s, ids, duree, dateStr, qui){
    var m = /(\d+)-(\d+)-(\d+)/.exec(dateStr), a = +m[1], mo = +m[2], j = +m[3];
    var jourSem = new Date(Date.UTC(a, mo - 1, j)).getUTCDay();
    var res = eligibles(s, ids); if(qui && qui !== 'any') res = res.filter(function(i){ return i.id === qui; });
    var maintenant = Date.now(), tot = maintenant + 2 * 3600000, tard = maintenant + 21 * 86400000, par = {};
    res.forEach(function(i){
      var pl = plage(s, i, jourSem); if(!pl) return;
      var busy = occupes(s, i, dateStr);
      for(var t = pl.d; t + duree <= pl.f; t += s.pas){
        var deb = parisVersUtc(a, mo, j, Math.floor(t / 60), t % 60).getTime(), fin = deb + duree * 60000;
        if(deb < tot || deb > tard) continue;
        if(busy.some(function(b){ return deb < b.b && fin > b.a; })) continue;
        (par[t] = par[t] || []).push(i.id);
      }
    });
    return Object.keys(par).map(Number).sort(function(x, y){ return x - y; }).map(function(t){ return { iso: parisVersUtc(a, mo, j, Math.floor(t / 60), t % 60).toISOString(), qui: par[t] }; });
  }
  var dureeDe = function(s, ids){ return ids.reduce(function(t, id){ return t + s.prestations.filter(function(p){ return p.id === id; })[0].duree; }, 0); };
  var jourStr = function(offset){ var c = composants(new Date()); return new Date(Date.UTC(c.annee, c.mois - 1, c.jour + offset)).toISOString().slice(0, 10); };

  // ------------------------------------------------------------- formats API
  function listePrestations(s){
    return s.prestations.map(function(p){
      return { id: p.id, libelle: p.libelle, description: p.description || null, prix_unitaire: p.prix, tva_taux: 0, duree_minutes: p.duree, public_cible: p.public, categorie: p.categorie,
        intervenants: s.equipe.filter(function(i){ return i.presta.indexOf(p.id) >= 0; }).map(function(i){ return i.id; }) };
    });
  }
  function avisListe(s){
    return s.avis.map(function(a, k){ return { note: a[1], commentaire: a[2], auteur: a[0], created_at: new Date(Date.now() - (k * 6 + 3) * 86400000).toISOString() }; });
  }
  function stylePourReservation(s){ var v = s.style; return { couleur: v.couleur, fond: v.fond, police: v.police, boutons: v.boutons }; }
  var pris = function(s){ var m = {}; s.prestations.forEach(function(p){ m[p.id] = p; }); return m; };

  function ics(s, debutIso, finIso, titre, qui){
    var f = function(d){ return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cadence//Demo//FR', 'BEGIN:VEVENT', 'UID:demo-' + Date.now() + '@cadence', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(debutIso), 'DTEND:' + f(finIso),
      'SUMMARY:' + titre + ' chez ' + s.nom, 'LOCATION:' + s.adresse, 'DESCRIPTION:Rendez-vous de démonstration Cadence' + (qui ? ' avec ' + qui : ''), 'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  // ----------------------------------------------------------------- routeur
  var fetchReel = window.fetch.bind(window);
  window.fetch = async function(entree, options){
    var url; try{ url = new URL(String(entree), location.origin); }catch(e){ return fetchReel(entree, options); }
    var chemin = url.pathname, q = url.searchParams;

    // Annuaire (explorer.html?demo=1)
    if(chemin === '/api/annuaire' && estAnnuaire){
      await wait(250);
      var liste = Object.keys(DEMOS).map(function(k){
        var s = DEMOS[k], notes = s.avis.map(function(a){ return a[1]; }), pub = {};
        s.prestations.forEach(function(p){ if(p.public === 'mixte'){ pub.femme = pub.homme = 1; } else pub[p.public] = 1; });
        return { slug: k, nom: s.nom, metier: s.metier, ville: s.ville, logo_url: null, photo: s.style.cover_url, description: s.style.accroche, latitude: s.latitude, longitude: s.longitude,
          prix_a_partir_de: Math.min.apply(null, s.prestations.map(function(p){ return p.prix; })), nb_prestations: s.prestations.length, publics: Object.keys(pub),
          note_moyenne: Math.round(notes.reduce(function(a, b){ return a + b; }, 0) / notes.length * 10) / 10, nb_avis: notes.length };
      });
      var norm = function(x){ return String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
      var qt = norm(q.get('q')), vi = norm(q.get('ville')), me = q.get('metier') || '', pu = q.get('public') || '';
      liste = liste.filter(function(x){ return (!me || x.metier === me) && (!pu || x.publics.indexOf(pu) >= 0) && (!vi || norm(x.ville).indexOf(vi) >= 0) && (!qt || norm(x.nom + ' ' + x.description).indexOf(qt) >= 0); });
      return reponse({ praticiens: liste });
    }
    if(!salon) return fetchReel(entree, options);

    // Vitrine publique
    if(chemin === '/api/vitrine'){
      await wait(200);
      var v = salon.style;
      return reponse({
        slug: slug, nom: salon.nom, metier: salon.metier, logo_url: null, accent: salon.accent, ville: salon.ville,
        horaires: { jours: salon.jours, debut: salon.debut, fin: salon.fin }, adresse: salon.adresse, latitude: salon.latitude, longitude: salon.longitude,
        vitrine: { accroche: v.accroche, a_propos: v.a_propos, cover_url: v.cover_url, galerie: v.galerie, mise_en_page: v.mise_en_page, police: v.police, couleur: v.couleur, fond: v.fond, boutons: v.boutons,
          texte_bouton: v.texte_bouton, bandeau_actif: !!v.bandeau_actif, bandeau_texte: v.bandeau_texte || null, instagram: v.instagram, telephone_public: v.telephone_public, email_public: v.email_public || null,
          sections: { a_propos: true, prestations: true, galerie: true, equipe: true, avis: true, horaires: true, carte: true }, ordre: ['a_propos', 'prestations', 'galerie', 'equipe', 'horaires', 'carte', 'avis'] },
        equipe: salon.equipe.map(function(i){ return { nom: i.nom, role: i.role, bio: i.bio, photo_url: null }; }),
        prestations: listePrestations(salon), avis: avisListe(salon)
      });
    }

    // Disponibilités
    if(chemin === '/api/reservation-disponibilites'){
      var idsParam = q.get('prestation_ids');
      if(!idsParam){
        await wait(250);
        return reponse({
          praticien: { business_name: salon.nom, logo_url: null, accent: salon.accent, metier: salon.metier },
          style: stylePourReservation(salon),
          intervenants: salon.equipe.map(function(i){ return { id: i.id, nom: i.nom, role: i.role, photo_url: null }; }),
          validation_auto: true, prestations: listePrestations(salon),
          paiement_requis: salon.paiement.en_ligne, paiement: salon.paiement,
          reglages: { jours_ouvres: salon.jours, heure_debut: salon.debut, heure_fin: salon.fin, delai_min_heures: 2, horizon_jours: 21 }
        });
      }
      await wait(300);
      var ids = idsParam.split(',').filter(Boolean), qui = q.get('intervenant') || 'any', duree = dureeDe(salon, ids), el = eligibles(salon, ids);
      if(!el.length) return reponse({ creneaux: [], jours: [], raison: 'aucun_intervenant' });
      if(qui !== 'any' && !el.some(function(i){ return i.id === qui; })) return reponse({ creneaux: [], jours: [], raison: 'intervenant_indisponible' });
      if(q.get('jours') === '1'){
        var jours = []; for(var d = 0; d <= 21; d++){ var ds = jourStr(d); if(creneaux(salon, ids, duree, ds, qui).length) jours.push(ds); }
        return reponse({ jours: jours, raison: jours.length ? null : 'complet' });
      }
      return reponse({ date: q.get('date'), creneaux: creneaux(salon, ids, duree, q.get('date'), qui).map(function(x){ return x.iso; }) });
    }

    // Réservation (simulée)
    if(chemin === '/api/reservation-publique' && (options || {}).method === 'POST'){
      await wait(500);
      var b = JSON.parse(options.body), idsR = b.prestation_ids || [], dR = dureeDe(salon, idsR), deb = new Date(b.date_debut), finD = new Date(deb.getTime() + dR * 60000);
      var cp = composants(deb), dateStr = cp.annee + '-' + String(cp.mois).padStart(2, '0') + '-' + String(cp.jour).padStart(2, '0');
      var libres = creneaux(salon, idsR, dR, dateStr, b.intervenant_id || 'any').filter(function(x){ return new Date(x.iso).getTime() === deb.getTime(); })[0];
      if(!libres) return reponse({ error: 'Ce créneau vient d\'être pris, choisissez-en un autre.' }, 409);
      var charge = function(id){ return lire().filter(function(x){ return x.slug === slug && x.interv === id; }).length; };
      var choisi = libres.qui.slice().sort(function(x, y){ return charge(x) - charge(y); })[0];
      var nomChoisi = salon.equipe.filter(function(i){ return i.id === choisi; })[0].nom;
      var l = lire(); l.push({ slug: slug, interv: choisi, a: deb.getTime(), b: finD.getTime() }); ecrire(l);

      var total = idsR.reduce(function(t, id){ return t + pris(salon)[id].prix; }, 0), cfg = salon.paiement;
      var acompte = Math.min(total, Math.max(cfg.acompte_minimum, Math.round(total * cfg.acompte_pourcentage) / 100));
      var surPlace = b.mode_paiement === 'sur_place' && cfg.especes && acompte < total;
      var aPayer = !cfg.en_ligne ? 0 : (surPlace ? acompte : total);
      if(aPayer > 0) return reponse({ url: 'paiement-merci.html?statut=succes&demo=1&p=' + slug });   // Stripe simulé
      var titre = idsR.map(function(id){ return pris(salon)[id].libelle; }).join(' + ');
      var blob = new Blob([ics(salon, deb, finD, titre, nomChoisi)], { type: 'text/calendar' });
      return reponse({ ok: true, confirme: true, intervenant: nomChoisi, ics_url: URL.createObjectURL(blob) });
    }
    return fetchReel(entree, options);
  };

  // ------------------------------------------------------------- pastille démo
  function pastille(){
    var el = document.createElement('div');
    el.setAttribute('role', 'note');
    el.style.cssText = 'position:fixed;left:12px;bottom:' + (window.innerWidth <= 880 ? '88px' : '14px') + ';z-index:9999;display:flex;align-items:center;gap:8px;padding:7px 8px 7px 12px;border-radius:999px;background:#101216;color:#F1F1EE;font:600 12.5px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);';
    el.innerHTML = '<span>Démo : données fictives</span><button type="button" style="border:none;border-radius:999px;background:#E2A63D;color:#101216;font:700 12px system-ui,sans-serif;padding:7px 12px;cursor:pointer;min-height:32px;">Réinitialiser</button><a href="demo.html" style="color:#F1F1EE;text-decoration:underline;padding:0 6px;">Retour</a>';
    el.querySelector('button').addEventListener('click', function(){ try{ sessionStorage.removeItem(DEMO_CLE); }catch(e){} location.reload(); });
    document.body.appendChild(el);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pastille); else pastille();
})();
