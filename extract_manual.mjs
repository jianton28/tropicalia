import fs from 'fs';
import pdf from './node_modules/pdf-parse/index.js';

const filePath = 'C:/Users/jian2/Downloads/Manual de Marca_TropicaliaCRB_PDF.pdf';

try {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  console.log('--- NUM PAGES ---', data.numpages);
  console.log('--- TEXT PREVIEW ---');
  fs.writeFileSync('manual_text.txt', data.text);
  console.log('Saved to manual_text.txt. Length:', data.text.length);
} catch (err) {
  console.error('Error reading PDF:', err);
}

