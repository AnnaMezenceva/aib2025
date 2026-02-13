// app.js (Version using Hugging Face Inference API)

// Global variables
let reviews = [];
let apiToken = "";

// DOM elements
const analyzeBtn = document.getElementById("analyze-btn");
const reviewText = document.getElementById("review-text");
const sentimentResult = document.getElementById("sentiment-result");
const loadingElement = document.querySelector(".loading");
const errorElement = document.getElementById("error-message");
const apiTokenInput = document.getElementById("api-token");

// Initialize the app
document.addEventListener("DOMContentLoaded", function () {
  // Load the TSV file
  loadReviews();

  // Set up event listeners
  analyzeBtn.addEventListener("click", analyzeRandomReview);
  apiTokenInput.addEventListener("change", saveApiToken);

  // Load saved API token from localStorage if exists
  const savedToken = localStorage.getItem("hfApiToken");
  if (savedToken) {
    apiTokenInput.value = savedToken;
    apiToken = savedToken;
  }
});

// Load and parse the TSV file using Papa Parse
function loadReviews() {
  fetch("reviews_test.tsv")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load TSV file (HTTP ${response.status})`);
      }
      return response.text();
    })
    .then((tsvData) => {
      Papa.parse(tsvData, {
        header: true,
        delimiter: "\t",
        skipEmptyLines: true,
        complete: (results) => {
          // Check if data and 'text' column exist
          if (!results.data || results.data.length === 0) {
            throw new Error("No data found in TSV file.");
          }
          reviews = results.data
            .map((row) => row.text)
            .filter((text) => typeof text === "string" && text.trim() !== "");
          
          if (reviews.length === 0) {
            throw new Error("No valid 'text' column found or reviews are empty.");
          }
          console.log("Loaded", reviews.length, "reviews");
        },
        error: (error) => {
          console.error("Papa Parse error:", error);
          showError("Failed to parse TSV file. Please check the file format.");
        },
      });
    })
    .catch((error) => {
      console.error("TSV load error:", error);
      showError(`Failed to load reviews: ${error.message}. Make sure reviews_test.tsv is in the same folder.`);
    });
}

// Save API token to localStorage
function saveApiToken() {
  apiToken = apiTokenInput.value.trim();
  if (apiToken) {
    localStorage.setItem("hfApiToken", apiToken);
  } else {
    localStorage.removeItem("hfApiToken");
  }
}

// Analyze a random review
function analyzeRandomReview() {
  // Hide previous error
  hideError();

  // Validation
  if (!Array.isArray(reviews) || reviews.length === 0) {
    showError("No reviews available. Please check that reviews_test.tsv is loaded correctly.");
    return;
  }

  // Select a random review
  const randomIndex = Math.floor(Math.random() * reviews.length);
  const selectedReview = reviews[randomIndex];

  // Display the review text
  reviewText.textContent = selectedReview;

  // Update UI for loading state
  loadingElement.style.display = "block";
  analyzeBtn.disabled = true;
  sentimentResult.innerHTML = ""; // Clear previous result
  sentimentResult.className = "sentiment-result"; // Reset classes

  // Call the Hugging Face API
  analyzeSentimentWithHF(selectedReview)
    .then((apiResponse) => displaySentiment(apiResponse))
    .catch((error) => {
      console.error("API Error:", error);
      showError(error.message || "Failed to analyze sentiment. Check your token or network.");
    })
    .finally(() => {
      loadingElement.style.display = "none";
      analyzeBtn.disabled = false;
    });
}

// Call Hugging Face Inference API
async function analyzeSentimentWithHF(text) {
  const apiUrl = "https://api-inference.huggingface.co/models/siebert/sentiment-roberta-large-english";
  
  // Prepare headers
  const headers = {
    "Content-Type": "application/json",
  };

  // Add Authorization header only if token is provided
  if (apiToken) {
    headers["Authorization"] = `Bearer ${apiToken}`;
  }

  // Prepare request body
  const body = JSON.stringify({ inputs: text });

  // Make the API call
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: headers,
    body: body,
  });

  // Handle HTTP errors
  if (!response.ok) {
    let errorMsg = `API Error (HTTP ${response.status})`;
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || errorMsg;
    } catch (e) {
      // Ignore if response is not JSON
    }
    throw new Error(errorMsg);
  }

  // Parse the JSON response
  let result;
  try {
    result = await response.json();
  } catch (e) {
    throw new Error("Invalid JSON response from API.");
  }

  // The API returns an array of arrays, e.g., [[{label: "POSITIVE", score: 0.99}]]
  if (!Array.isArray(result) || result.length === 0 || !Array.isArray(result[0]) || result[0].length === 0) {
    throw new Error("Unexpected response format from API.");
  }

  // Return the result in the format expected by displaySentiment (an array of predictions)
  return result;
}

// Display sentiment result
function displaySentiment(apiResult) {
  // Default to neutral
  let sentiment = "neutral";
  let score = 0.5;
  let label = "NEUTRAL";

  // Extract the first prediction from the response
  // Expected format: [[{label: 'POSITIVE', score: 0.99}]]
  if (
    Array.isArray(apiResult) &&
    apiResult.length > 0 &&
    Array.isArray(apiResult[0]) &&
    apiResult[0].length > 0
  ) {
    const prediction = apiResult[0][0];

    if (prediction && typeof prediction === "object") {
      label = prediction.label ? prediction.label.toUpperCase() : "NEUTRAL";
      score = typeof prediction.score === "number" ? prediction.score : 0.5;

      // Determine final sentiment based on rules
      if (label === "POSITIVE" && score > 0.5) {
        sentiment = "positive";
      } else if (label === "NEGATIVE" && score > 0.5) {
        sentiment = "negative";
      } else {
        sentiment = "neutral";
      }
    }
  }

  // Update the UI with the result
  sentimentResult.classList.add(sentiment);
  sentimentResult.innerHTML = `
        <i class="fas ${getSentimentIcon(sentiment)} icon"></i>
        <span>${sentiment.toUpperCase()} (${(score * 100).toFixed(1)}% confidence)</span>
    `;
}

// Get appropriate icon for sentiment bucket
function getSentimentIcon(sentiment) {
  switch (sentiment) {
    case "positive":
      return "fa-thumbs-up";
    case "negative":
      return "fa-thumbs-down";
    default:
      return "fa-question-circle";
  }
}

// Show error message
function showError(message) {
  errorElement.textContent = message;
  errorElement.style.display = "block";
}

// Hide error message
function hideError() {
  errorElement.style.display = "none";
}
