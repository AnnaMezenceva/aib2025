// app.js - Версия с анализом тональности, подсчетом существительных и сохранением в Google Sheets

// Глобальные переменные
let reviews = [];
let currentReview = null;

// ЗАМЕНИТЕ ЭТОТ URL НА ВАШ РЕАЛЬНЫЙ URL ОТ GOOGLE APPS SCRIPT!
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbxFB5LX_64UjMbRN5W2xTZEHlhw4TjatscIX2NCCm3pfqj_3ftj3OhCDzpQPlXj9kElRg/exec";

// DOM элементы
const randomReviewBtn = document.getElementById('randomReview');
const analyzeSentimentBtn = document.getElementById('analyzeSentiment');
const countNounsBtn = document.getElementById('countNouns');
const reviewTextElement = document.getElementById('reviewText');
const sentimentResult = document.getElementById('sentimentResult');
const nounResult = document.getElementById('nounResult');
const tokenInput = document.getElementById('token');
const spinner = document.getElementById('spinner');
const errorDiv = document.getElementById('error');

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
    await loadReviews();
    
    // Загружаем сохраненный токен из localStorage
    const savedToken = localStorage.getItem('hfApiToken');
    if (savedToken) {
        tokenInput.value = savedToken;
    }
    
    // Добавляем обработчики событий
    randomReviewBtn.addEventListener('click', selectRandomReview);
    analyzeSentimentBtn.addEventListener('click', analyzeSentiment);
    countNounsBtn.addEventListener('click', countNouns);
    tokenInput.addEventListener('change', saveApiToken);
});

// Загрузка отзывов из TSV файла
async function loadReviews() {
    try {
        const response = await fetch('reviews_test.tsv');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const tsvData = await response.text();
        
        const parsed = Papa.parse(tsvData, {
            header: true,
            delimiter: '\t',
            skipEmptyLines: true
        });
        
        reviews = parsed.data.filter(review => review.text && review.text.trim() !== '');
        console.log(`Loaded ${reviews.length} reviews`);
        
    } catch (error) {
        showError('Failed to load reviews data: ' + error.message);
    }
}

// Сохранение токена в localStorage
function saveApiToken() {
    const token = tokenInput.value.trim();
    if (token) {
        localStorage.setItem('hfApiToken', token);
    } else {
        localStorage.removeItem('hfApiToken');
    }
}

// Выбор случайного отзыва
function selectRandomReview() {
    if (reviews.length === 0) {
        showError('No reviews available');
        return;
    }
    
    const randomIndex = Math.floor(Math.random() * reviews.length);
    currentReview = reviews[randomIndex];
    reviewTextElement.textContent = currentReview.text;
    
    resetResults();
    hideError();
}

// Сброс результатов
function resetResults() {
    sentimentResult.textContent = '❓';
    nounResult.textContent = '❓';
}

// Анализ тональности
async function analyzeSentiment() {
    if (!currentReview) {
        showError('Please select a review first');
        return;
    }
    
    const prompt = `Classify this review as positive, negative, or neutral. Return only one word. Review: "${currentReview.text}"`;
    const result = await callApi(prompt, 'sentiment');
    
    if (result) {
        updateSentimentResult(result);
        
        // Сохраняем результат в Google Sheets
        saveToGoogleSheets({
            reviewText: currentReview.text,
            analysisType: 'sentiment',
            result: result,
            prompt: prompt
        });
    }
}

// Подсчет существительных
async function countNouns() {
    if (!currentReview) {
        showError('Please select a review first');
        return;
    }
    
    const prompt = `Count the nouns in this review and return only **High** (>15), **Medium** (6-15), or **Low** (<6). Review: "${currentReview.text}"`;
    const result = await callApi(prompt, 'nouns');
    
    if (result) {
        updateNounResult(result);
        
        // Сохраняем результат в Google Sheets
        saveToGoogleSheets({
            reviewText: currentReview.text,
            analysisType: 'nouns',
            result: result,
            prompt: prompt
        });
    }
}

// Вызов API Hugging Face
async function callApi(prompt, type) {
    const token = tokenInput.value.trim();
    
    hideError();
    spinner.style.display = 'block';
    disableButtons(true);
    
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch('https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ 
                inputs: prompt,
                parameters: {
                    max_new_tokens: 50,
                    temperature: 0.1,
                    return_full_text: false
                }
            })
        });
        
        if (response.status === 401 || response.status === 403) {
            throw new Error('Invalid or missing API token');
        }
        
        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please try again later.');
        }
        
        if (response.status === 503) {
            throw new Error('Model is loading. Please try again in a few seconds.');
        }
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Извлекаем сгенерированный текст
        let resultText = '';
        if (Array.isArray(data) && data.length > 0) {
            resultText = data[0]?.generated_text || '';
        } else if (data.generated_text) {
            resultText = data.generated_text;
        }
        
        // Удаляем промпт из результата, если он там есть
        resultText = resultText.replace(prompt, '').trim().toLowerCase();
        
        // Извлекаем первое слово или фразу
        const firstWord = resultText.split(/[\s,.;:!?]+/)[0] || '';
        
        return firstWord;
        
    } catch (error) {
        showError(error.message);
        return null;
    } finally {
        spinner.style.display = 'none';
        disableButtons(false);
    }
}

// Обновление результата тональности
function updateSentimentResult(text) {
    let icon = '❓';
    let cleanText = text.toLowerCase().trim();
    
    if (cleanText.includes('positive') || cleanText === 'positive') {
        icon = '👍';
        sentimentResult.textContent = icon;
        sentimentResult.className = 'positive';
    } else if (cleanText.includes('negative') || cleanText === 'negative') {
        icon = '👎';
        sentimentResult.textContent = icon;
        sentimentResult.className = 'negative';
    } else if (cleanText.includes('neutral') || cleanText === 'neutral') {
        icon = '❓';
        sentimentResult.textContent = icon;
        sentimentResult.className = 'neutral';
    } else {
        sentimentResult.textContent = icon;
        sentimentResult.className = '';
    }
}

// Обновление результата подсчета существительных
function updateNounResult(text) {
    let icon = '❓';
    let cleanText = text.toLowerCase().trim();
    
    if (cleanText.includes('high') || cleanText === 'high') {
        icon = '🟢';
        nounResult.textContent = icon;
        nounResult.className = 'high';
    } else if (cleanText.includes('medium') || cleanText === 'medium') {
        icon = '🟡';
        nounResult.textContent = icon;
        nounResult.className = 'medium';
    } else if (cleanText.includes('low') || cleanText === 'low') {
        icon = '🔴';
        nounResult.textContent = icon;
        nounResult.className = 'low';
    } else {
        nounResult.textContent = icon;
        nounResult.className = '';
    }
}

// Сохранение в Google Sheets
async function saveToGoogleSheets(data) {
    const token = tokenInput.value.trim();
    
    // Создаем индикатор сохранения
    const saveIndicator = document.createElement('div');
    saveIndicator.className = 'save-indicator';
    saveIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    document.querySelector('.results').appendChild(saveIndicator);
    
    try {
        // Подготавливаем данные для отправки
        const sheetData = {
            timestamp: new Date().toISOString(),
            reviewText: data.reviewText,
            analysisType: data.analysisType === 'sentiment' ? 'Sentiment Analysis' : 'Noun Count',
            result: data.result,
            prompt: data.prompt,
            tokenUsed: !!token
        };
        
        // Отправляем в Google Sheets
        await fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(sheetData)
        });
        
        // Показываем успех
        saveIndicator.innerHTML = '<i class="fas fa-check" style="color: green;"></i> Saved!';
        
        setTimeout(() => {
            if (saveIndicator.parentNode) {
                saveIndicator.remove();
            }
        }, 2000);
        
    } catch (error) {
        console.error('Error saving to Google Sheets:', error);
        saveIndicator.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: orange;"></i> Save failed';
        
        setTimeout(() => {
            if (saveIndicator.parentNode) {
                saveIndicator.remove();
            }
        }, 3000);
    }
}

// Блокировка/разблокировка кнопок
function disableButtons(disabled) {
    const buttons = [randomReviewBtn, analyzeSentimentBtn, countNounsBtn];
    buttons.forEach(button => {
        if (button) button.disabled = disabled;
    });
}

// Показ ошибки
function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

// Скрытие ошибки
function hideError() {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
}
