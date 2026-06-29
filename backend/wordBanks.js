/**
 * Word banks for matchmaking — partitioned by language.
 * Standard English + 8 Romanized Indian languages (Hinglish, Tamiglish, Teluglish,
 * Benglish, Marathiglish, Gujaratinglish, Kannadaglish, Malayalaglish).
 * Words are kept short, family-friendly, drawable, and use Latin letters.
 */
const ENGLISH = [
  'apple','banana','car','dog','cat','house','tree','sun','moon','star',
  'rainbow','umbrella','pizza','burger','ice cream','rocket','spaceship','robot','dinosaur','dragon',
  'castle','sword','crown','wizard','witch','ghost','pumpkin','snowman','santa','elf',
  'fish','shark','whale','dolphin','crab','octopus','turtle','frog','butterfly','bee',
  'flower','mountain','river','beach','volcano','tornado','lightning','cloud','windmill','lighthouse',
  'bicycle','motorbike','airplane','helicopter','train','submarine','tractor','bus','taxi','boat',
  'guitar','piano','drum','violin','microphone','headphones','camera','telephone','television','laptop',
  'pencil','crayon','paintbrush','scissors','glue','ruler','book','backpack','clock','calendar',
  'donut','cupcake','sandwich','noodles','watermelon','strawberry','pineapple','grapes','carrot','broccoli',
  'football','basketball','tennis','cricket','chess','kite','swing','slide','sandcastle','snowflake',
];

// Hinglish — Hindi words written in Latin script
const HINGLISH = [
  'seb','kela','aam','santara','angoor','tarbooz','anar','papita','badam','kaju',
  'gaadi','train','hawai jahaaj','cycle','bus','scooter','jahaz','helicopter','rickshaw','metro',
  'kutta','billi','sher','hathi','bandar','gay','bakri','ghoda','machhli','kabootar',
  'phool','ped','paani','pahad','samundar','baadal','suraj','chand','tara','barish',
  'ghar','school','mandir','dukaan','khidki','darwaza','chhat','rasoi','bistar','kursi',
  'roti','chawal','dal','sabzi','pani puri','samosa','chai','laddoo','jalebi','barfi',
  'kitab','pen','pencil','copy','bag','ghadi','chappal','kapde','topi','chashma',
  'doctor','shikshak','kisan','sipahi','daakiya','bawarchi','painter','mochi','dhobi','majdoor',
  'doll','gend','patang','guddi','tasveer','rangoli','diya','rakhi','holi','diwali',
  'titli','machhar','makdi','keeda','chiraiya','tota','mor','ulluu','sherni','khargosh',
];

// Tamiglish — Tamil words in Latin script
const TAMIGLISH = [
  'appil','vazhai','manga','tharbusa','angur','santara','pala','peeradi','elumichai','komatti',
  'vandi','train','vimanam','cycle','bus','scooter','autorickshaw','padagu','helicopter','lorry',
  'naai','poonai','singam','yaanai','kuranggu','maadu','aadu','kudirai','meen','puraavu',
  'poo','maram','thanneer','malai','kadal','megam','sooriyan','nilavu','natchatiram','mazhai',
  'veedu','palli','kovil','kadai','jannal','kathavu','koodai','samayalarai','padukkai','naarkali',
  'sappadu','dosai','idli','vada','sambar','rasam','poriyal','payasam','laddu','jangiri',
  'puthagam','pena','pencil','vagupparai','sancheri','kadigaaram','chappal','udai','thoppi','kannadi',
  'maruthuvar','aasiriyar','vivasayi','seriff','tabal','samaiyalkarar','oviyar','seruppu','vannan','velaiyaaki',
  'bommai','panthu','gaali patam','pavadai','padam','kolam','vilakku','rakshabandhanam','holi','deepavali',
  'vannathu poochi','kosu','silandhi','poochi','kuruvi','kili','mayil','aandhai','singam pen','muyal',
];

// Teluglish — Telugu words in Latin script
const TELUGLISH = [
  'apple','arati','mamidi','dosakaya','draksha','butta','jamapandu','sapota','nimma','jeedipappu',
  'bandi','railu','vimanam','saikilu','bassu','scooteru','autorickshaw','pada','helicopter','lorry',
  'kukka','pilli','simham','enugu','kothi','aavu','meka','gurram','chepa','pavuram',
  'puvvu','chettu','neeru','konda','samudram','meghaalu','suryudu','chandrudu','nakshatram','varsham',
  'illu','badi','gudi','dukan','kitiki','talupu','kappu','vantillu','manchi','kursi',
  'annam','dosa','idli','vada','sambar','rasam','kura','payasam','laddu','jangri',
  'pustakam','kalam','pencillu','notebooku','sancheri','gadi','cheppulu','battalu','toppi','kannulujodu',
  'doctoru','upadyaaya','rythu','sainikudu','tapaala','vantaadu','rangulu','cheppu','dhobi','panilo',
  'bomma','bantu','gaalipatam','paavada','chitram','muggu','deepam','rakhi','holi','deepavali',
  'sitakoka chiluka','dommadu','salipi','purugu','pichuka','chilaka','nemali','sundarudu','simhi','kundelu',
];

// Benglish — Bengali words in Latin script
const BENGLISH = [
  'apel','kola','aam','dosabaaya','aangur','tarmuj','peyarah','komala','lebu','kaju',
  'gari','train','plane','cycle','bus','scooter','rickshaw','noukah','helicopter','truck',
  'kukur','beral','singho','hathi','bandor','goru','chhagol','ghora','machh','paayra',
  'phool','gachh','jol','paahar','shomudro','megh','shurjo','chaand','tara','brishti',
  'baari','school','mandir','dokan','janala','dorja','chhad','rannaghor','bichana','chaair',
  'bhaat','dosa','idli','vada','dal','torkari','cha','rashogolla','sandesh','mishti',
  'boi','kalam','pencil','khata','byag','ghori','jutopaati','kapor','topi','choshma',
  'daaktar','shikkhok','chashi','soinik','daak','baburchi','silpi','muchi','dhopa','shromiK',
  'putul','bol','ghuri','pori','chhobi','alpona','prodip','rakhi','holi','dipaboli',
  'projapoti','mashar','makorsha','poka','chorai','tia','mayur','pacha','singhini','khorgosh',
];

// Marathiglish — Marathi in Latin script
const MARATHIGLISH = [
  'safarchand','keli','amba','tarbuj','draksh','santra','peru','kavath','limbu','kaju',
  'gadi','railgaadi','vimaan','cycle','bus','scooter','rickshaw','nau','helicopter','truck',
  'kutra','manjar','singh','haatti','maakad','gaay','bakri','ghoda','maasa','kabutar',
  'phul','jhad','paani','dongar','samudr','dhag','surya','chandra','chandani','paaus',
  'ghar','shaalA','mandir','dukan','khidki','darvaja','chhat','swayampakkhana','palang','khurchi',
  'bhakri','dosa','idli','vada','varan','bhaaji','chaha','puranpoli','laddu','barfi',
  'pustak','pen','pencil','vahi','bag','ghadyaal','chappal','kapde','topi','chashma',
  'daktor','shikshak','sheth','sainik','postman','swayampaki','chitrakar','mochi','dhobi','majoor',
  'baahuli','chendoo','patang','pari','chitra','rangoli','diva','raakhi','holi','divali',
  'phulpaakharu','dass','kolhi','kida','chimani','popat','mor','ghuban','singhi','sasla',
];

// Gujaratinglish — Gujarati in Latin script
const GUJARATINGLISH = [
  'safarjan','kela','keri','tarbuch','draksh','santro','jambu','sapota','limbu','kaju',
  'gaadi','train','viman','cycle','bus','scooter','rickshaw','navadi','helicopter','truck',
  'kutro','biladi','singh','hathi','vaandro','gaay','bakri','ghodo','machhli','holo',
  'phool','jhaad','paani','pahaad','dariyo','vaadal','suraj','chand','taarO','varsaad',
  'ghar','shala','mandir','dukan','baari','baranu','chhat','rasodu','palang','khursi',
  'rotli','dhokla','khaman','khichdi','daal','shaak','chai','jalebi','laddoo','barfi',
  'pustak','pen','pencil','notebook','thelo','ghadiyal','chappal','kapda','topi','chashma',
  'doctor','shikshak','khedut','sainik','tapaal','rasoiyo','chitrakaar','mochi','dhobi','majoor',
  'puthi','dado','patang','pari','chitra','rangoli','diva','rakhi','holi','divaali',
  'patangiyu','machhar','kothilo','jivat','chakli','popat','mor','ghuvad','singhi','salaslo',
];

// Kannadaglish — Kannada in Latin script
const KANNADAGLISH = [
  'sebu','baale','maavu','kallangadi','dhrakshi','kittale','peraale','sapota','nimbe','geru',
  'gaadi','railu','vimaana','cycle','bus','scooter','autorickshaw','dongi','helicopter','lorry',
  'nai','bekku','simha','aane','manga','dana','meke','kudure','meenu','paaravaala',
  'hoovu','mara','neeru','betta','samudra','moda','surya','chandra','nakshatra','male',
  'mane','shaale','dewasthana','angadi','kitaki','baagilu','chappara','adugemane','manche','kursi',
  'anna','dose','idli','vade','saambaaru','rasam','palya','paayasa','laddoo','jangri',
  'pustaka','lekkani','pencillu','aSHTadalapustaka','chee laggadike','gadiyaara','cheppali','batte','topi','kannadaka',
  'vaidya','shikshaka','rythu','soldieru','dakiyaa','aDugeyavaru','chitrakaara','muchi','dhobi','kelasagara',
  'bombe','chenduh','gaaliputa','sundari','chitra','rangoli','deepa','raksabandhana','holi','deepaavali',
  'chitte','sokku','jeruvi','huvvu','gubbi','popat','navilu','goobe','simhi','molaha',
];

// Malayalaglish — Malayalam in Latin script
const MALAYALAGLISH = [
  'apil','vazha','manga','tharmusa','muntiri','orange','sapota','peraka','cherunaranga','kasuvandi',
  'vandi','train','vimanam','cycle','bus','scooter','autorickshaw','vallam','helicopter','lorry',
  'paatti','poocha','simham','aana','kurangu','pashu','aadu','kudira','meen','pravan',
  'poovu','maram','vellam','mala','kadal','meghhom','sooryan','chandran','nakshatram','mazha',
  'veedu','school','ambalam','kada','janal','vaathil','sopanam','adukkala','kattili','kasera',
  'choru','dosa','idli','vada','sambhar','rasam','thoran','payasam','laddu','jangiri',
  'pusthakam','pena','pensil','book','sancheri','clocku','chappal','vasthram','thoppi','kannadi',
  'doctor','adhyaapakan','karshakan','padayaali','postman','adukkalapani','chitrakaaran','muchi','dhobi','jolikkaran',
  'bomma','panthu','gaalipatam','paari','chithram','kolam','vilakku','rakhi','holi','deepaavali',
  'pookoothi','machhar','chilanthi','keedam','kuruvi','thatha','mayil','udhi','simha penn','muyal',
];

const WORD_BANKS = {
  0: { code: 'english', name: 'English', words: ENGLISH },
  1: { code: 'hinglish', name: 'Hinglish', words: HINGLISH },
  2: { code: 'tamiglish', name: 'Tamiglish', words: TAMIGLISH },
  3: { code: 'teluglish', name: 'Teluglish', words: TELUGLISH },
  4: { code: 'benglish', name: 'Benglish', words: BENGLISH },
  5: { code: 'marathiglish', name: 'Marathiglish', words: MARATHIGLISH },
  6: { code: 'gujaratinglish', name: 'Gujaratinglish', words: GUJARATINGLISH },
  7: { code: 'kannadaglish', name: 'Kannadaglish', words: KANNADAGLISH },
  8: { code: 'malayalaglish', name: 'Malayalaglish', words: MALAYALAGLISH },
};

function getLanguageList() {
  return Object.entries(WORD_BANKS).map(([id, v]) => ({
    id: Number(id),
    code: v.code,
    name: v.name,
  }));
}

function getWords(langId, count = 3) {
  const bank = WORD_BANKS[langId] || WORD_BANKS[0];
  const words = bank.words;
  const picks = new Set();
  while (picks.size < count && picks.size < words.length) {
    picks.add(words[Math.floor(Math.random() * words.length)]);
  }
  return Array.from(picks);
}

module.exports = { WORD_BANKS, getLanguageList, getWords };
