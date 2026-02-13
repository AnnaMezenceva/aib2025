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
    console.log('App initialized');
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
    
    console.log('Event listeners added');
});

// Загрузка отзывов из TSV файла
async function loadReviews() {
    try {
        console.log('Loading reviews...');
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
        
        if (reviews.length === 0) {
            showError('No valid reviews found in the file');
        }
        
    } catch (error) {
        console.error('Error loading reviews:', error);
        showError('Failed to load reviews data: ' + error.message);
    }
}

// Сохранение токена в localStorage
function saveApiToken() {
    const token = tokenInput.value.trim();
    if (token) {
        localStorage.setItem('hfApiToken', token);
        console.log('Token saved');
    } else {
        localStorage.removeItem('hfApiToken');
        console.log('Token removed');
    }
}

// Выбор случайного отзыва
function selectRandomReview() {
    console.log('Selecting random review');
    if (reviews.length === 0) {
        showError('No reviews available. Please check the TSV file.');
        return;
    }
    
    const randomIndex = Math.floor(Math.random() * reviews.length);
    currentReview = reviews[randomIndex];
    reviewTextElement.textContent = currentReview.text;
    console.log('Selected review:', currentReview.text.substring(0, 50) + '...');
    
    resetResults();
    hideError();
}

// Сброс результатов
function resetResults() {
    sentimentResult.textContent = '❓';
    nounResult.textContent = '❓';
    sentimentResult.className = 'result-value';
    nounResult.className = 'result-value';
}

// Анализ тональности
async function analyzeSentiment() {
    console.log('Analyzing sentiment');
    if (!currentReview) {
        showError('Please select a review first');
        return;
    }
    
    const prompt = `Classify the sentiment of this review as either "positive", "negative", or "neutral". Reply with only one word. Review: "${currentReview.text}"`;
    const result = await callApi(prompt, 'sentiment');
    
    if (result) {
        updateSentimentResult(result);
        
        // Сохраняем результат в Google Sheets
        await saveToGoogleSheets({
            reviewText: currentReview.text,
            analysisType: 'sentiment',
            result: result,
            prompt: prompt
        });
    }
}

// Подсчет существительных
async function countNouns() {
    console.log('Counting nouns');
    if (!currentReview) {
        showError('Please select a review first');
        return;
    }
    
    const prompt = `Count the number of nouns in this review. Return only one word: "high" if more than 15, "medium" if between 6 and 15, or "low" if less than 6. Review: "${currentReview.text}"`;
    const result = await callApi(prompt, 'nouns');
    
    if (result) {
        updateNounResult(result);
        
        // Сохраняем результат в Google Sheets
        await saveToGoogleSheets({
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
        console.log('Calling API with prompt:', prompt.substring(0, 100) + '...');
        
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
                    max_new_tokens: 10,
                    temperature: 0.1,
                    return_full_text: false
                }
            })
        });
        
        console.log('API response status:', response.status);
        
        if (response.status === 401 || response.status === 403) {
            throw new Error('Invalid or missing API token. Please check your token.');
        }
        
        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please try again later or add an API token.');
        }
        
        if (response.status === 503) {
            throw new Error('Model is loading. Please try again in a few seconds.');
        }
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('API response data:', data);
        
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
        
        // Очищаем результат
        resultText = resultText.toLowerCase().trim();
        
        // Извлекаем ключевое слово
        let keyword = '';
        if (type === 'sentiment') {
            if (resultText.includes('positive')) keyword = 'positive';
            else if (resultText.includes('negative')) keyword = 'negative';
            else if (resultText.includes('neutral')) keyword = 'neutral';
            else keyword = 'neutral';
        } else if (type === 'nouns') {
            if (resultText.includes('high')) keyword = 'high';
            else if (resultText.includes('medium')) keyword = 'medium';
            else if (resultText.includes('low')) keyword = 'low';
            else keyword = 'medium';
        }
        
        console.log('Extracted keyword:', keyword);
        return keyword;
        
    } catch (error) {
        console.error('API call error:', error);
        showError(error.message);
        return null;
    } finally {
        spinner.style.display = 'none';
        disableButtons(false);
    }
}

// Обновление результата тональности
function updateSentimentResult(text) {
    console.log('Updating sentiment with:', text);
    let icon = '❓';
    let cleanText = text.toLowerCase().trim();
    
    if (cleanText.includes('positive')) {
        icon = '👍';
        sentimentResult.textContent = icon;
        sentimentResult.className = 'result-value positive';
    } else if (cleanText.includes('negative')) {
        icon = '👎';
        sentimentResult.textContent = icon;
        sentimentResult.className = 'result-value negative';
    } else if (cleanText.includes('neutral')) {
        icon = '❓';
        sentimentResult.textContent = icon;
        sentimentResult.className = 'result-value neutral';
    } else {
        sentimentResult.textContent = icon;
        sentimentResult.className = 'result-value';
    }
}

// Обновление результата подсчета существительных
function updateNounResult(text) {
    console.log('Updating nouns with:', text);
    let icon = '❓';
    let cleanText = text.toLowerCase().trim();
    
    if (cleanText.includes('high')) {
        icon = '🟢';
        nounResult.textContent = icon;
        nounResult.className = 'result-value high';
    } else if (cleanText.includes('medium')) {
        icon = '🟡';
        nounResult.textContent = icon;
        nounResult.className = 'result-value medium';
    } else if (cleanText.includes('low')) {
        icon = '🔴';
        nounResult.textContent = icon;
        nounResult.className = 'result-value low';
    } else {
        nounResult.textContent = icon;
        nounResult.className = 'result-value';
    }
}

// Сохранение в Google Sheets
async function saveToGoogleSheets(data) {
    const token = tokenInput.value.trim();
    
    // Создаем индикатор сохранения
    const saveIndicator = document.createElement('div');
    saveIndicator.className = 'save-indicator';
    saveIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving to Google Sheets...';
    
    // Находим контейнер для индикатора или добавляем в results
    const container = document.getElementById('saveIndicatorContainer') || document.querySelector('.results');
    container.appendChild(saveIndicator);
    
    try {
        // Подготавливаем данные для отправки
        const sheetData = {
            timestamp: new Date().toLocaleString(),
            reviewText: data.reviewText,
            analysisType: data.analysisType === 'sentiment' ? 'Sentiment Analysis' : 'Noun Count',
            result: data.result,
            prompt: data.prompt,
            tokenUsed: !!token
        };
        
        console.log('Saving to Google Sheets:', sheetData);
        
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
        saveIndicator.innerHTML = '<i class="fas fa-check" style="color: green;"></i> Saved to Google Sheets!';
        
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
        if (button) {
            button.disabled = disabled;
        }
    });
}

// Показ ошибки
function showError(message) {
    console.error('Error:', message);
    const errorSpan = errorDiv.querySelector('span') || document.createElement('span');
    errorSpan.textContent = message;
    if (!errorDiv.querySelector('span')) {
        errorDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> <span></span>';
        errorDiv.querySelector('span').textContent = message;
    } else {
        errorDiv.querySelector('span').textContent = message;
    }
    errorDiv.style.display = 'block';
}

// Скрытие ошибки
function hideError() {
    errorDiv.style.display = 'none';
}
