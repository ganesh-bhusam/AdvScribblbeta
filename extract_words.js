const fs = require('fs');
const readline = require('readline');
const path = require('path');

const transcriptPath = "C:\\Users\\PK'S\\.gemini\\antigravity-ide\\brain\\50190dc6-ba59-4b8c-8a7b-a12145ec6f15\\.system_generated\\logs\\transcript_full.jsonl";

async function extractWords() {
    const fileStream = fs.createReadStream(transcriptPath);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const words = {
        english: [],
        tamilglish: [],
        kannadaglish: [],
        malayalaglish: [],
        hinglish: []
    };

    let tableRegex = /\|\s*\d+\.\s+([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;

    for await (const line of rl) {
        try {
            const entry = JSON.parse(line);
            if (entry.type === 'USER_INPUT' || entry.type === 'USER_EXPLICIT' || entry.source === 'USER' || entry.source === 'USER_EXPLICIT') {
                const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);
                
                let match;
                while ((match = tableRegex.exec(content)) !== null) {
                    words.english.push(match[1].trim());
                    words.tamilglish.push(match[2].trim());
                    words.kannadaglish.push(match[3].trim());
                    words.malayalaglish.push(match[4].trim());
                    words.hinglish.push(match[5].trim());
                }
            }
        } catch (e) {
            // ignore JSON parse errors for malformed lines
        }
    }
    
    console.log(`Extracted:
        English: ${words.english.length}
        Tamilglish: ${words.tamilglish.length}
        Kannadaglish: ${words.kannadaglish.length}
        Malayalaglish: ${words.malayalaglish.length}
        Hinglish: ${words.hinglish.length}
    `);
    
    // De-duplicate while preserving order
    for (const key in words) {
        words[key] = [...new Set(words[key])].filter(w => w.length > 0 && w !== '-' && w !== '--');
    }
    
    console.log(`After deduplication:
        English: ${words.english.length}
        Tamilglish: ${words.tamilglish.length}
        Kannadaglish: ${words.kannadaglish.length}
        Malayalaglish: ${words.malayalaglish.length}
        Hinglish: ${words.hinglish.length}
    `);

    // Output to files
    const outDir = path.join("c:\\Users\\PK'S\\OneDrive\\Desktop\\AdvScribblw-with-backend-main\\backend\\data\\word_banks");
    
    // Format JSON with "words": { "value": [...] } as seen in existing en_english.json
    fs.writeFileSync(path.join(outDir, 'parsed_english.json'), JSON.stringify({words: {value: words.english}}, null, 2));
    fs.writeFileSync(path.join(outDir, 'parsed_tamilglish.json'), JSON.stringify({words: {value: words.tamilglish}}, null, 2));
    fs.writeFileSync(path.join(outDir, 'parsed_kannadaglish.json'), JSON.stringify({words: {value: words.kannadaglish}}, null, 2));
    fs.writeFileSync(path.join(outDir, 'parsed_malayalaglish.json'), JSON.stringify({words: {value: words.malayalaglish}}, null, 2));
    fs.writeFileSync(path.join(outDir, 'parsed_hinglish.json'), JSON.stringify({words: {value: words.hinglish}}, null, 2));
    
    console.log("Files written successfully to word_banks dir.");
}

extractWords();
