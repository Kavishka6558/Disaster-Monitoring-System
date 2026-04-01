"""
Disaster Monitoring System - ML Microservice
FastAPI service for XLM-RoBERTa based disaster text classification.
Supports Sinhala, Tamil, and English text.

Label Mapping (confirmed):
  Label 0 = Neutral/Medium
  Label 1 = High
"""

import os
import re
import logging
from pathlib import Path
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────
MODEL_PATH = os.getenv("MODEL_PATH", "../ml_model")
PORT = int(os.getenv("PORT", 8001))

# Label mapping: 0 = Neutral/Medium, 1 = High  (confirmed)
ID2LABEL = {0: "Neutral/Medium", 1: "High"}
LABEL2ID = {"Neutral/Medium": 0, "High": 1}

# ─── Sentiment Lexicons (EN / SI / TA keywords) ───────────────────────────────
POSITIVE_KEYWORDS = [
    # English
    "safe", "rescued", "relief", "recovered", "help arrived", "aid", "support",
    "evacuated", "shelter", "saved", "stable", "improving", "controlled",
    "contained", "cleared", "restored", "thankful", "grateful", "hope",
    # Sinhala transliterated
    "ආරක්ෂිත", "සහනය", "ගලවා", "සහාය",
    # Tamil transliterated
    "பாதுகாப்பு", "நிவாரணம்", "மீட்பு",
]

NEGATIVE_KEYWORDS = [
    # English
    "dead", "death", "killed", "missing", "trapped", "destroyed", "collapsed",
    "urgent", "critical", "severe", "dangerous", "fatal", "casualty", "casualties",
    "injured", "wounded", "stranded", "helpless", "desperate", "panic", "crisis",
    "devastating", "catastrophic", "emergency", "SOS", "help", "rescue needed",
    # Sinhala
    "මිය ගිය", "අතුරුදහන්", "හදිසි", "අනතුර", "ආධාර", "ජීවිත",
    # Tamil
    "இறந்தனர்", "காணாமல்", "அவசரம்", "ஆபத்து", "உதவி",
]

# ─── High-Emergency Keyword Override (multilingual) ──────────────────────────
# If the model returns Neutral/Medium but these strong disaster keywords are
# present, override to High. Handles cases where XLM-RoBERTa under-fires on
# Sinhala / Tamil disaster vocabulary it hasn't seen enough during training.
HIGH_EMERGENCY_KEYWORDS = [
    # English — flood / disaster / rescue
    "flood", "flooding", "landslide", "mudslide", "cyclone", "hurricane",
    "earthquake", "tsunami", "wildfire", "rescue", "trapped", "missing",
    "collapsed", "casualties", "urgent help", "need help", "SOS",
    # Sinhala — floods / disasters / urgent
    "ගංවතුර",    # flood
    "නාය යාම",   # landslide
    "සුළිඳලිය",  # cyclone
    "භූ කම්පාව", # earthquake
    "ගිනි",      # fire
    "ජලය",       # water (in disaster context)
    "හිරවී",     # trapped
    "බේරා ගන්න", # rescue
    "හදිසි",     # urgent/emergency
    "ආධාර අවශ්‍ය", # help needed
    "ජීවිත අහිමි",# lives lost
    "ජනතාවට ආධාර",# people need help
    "හානි",      # damage
    "දරුණු",     # severe
    "ව්‍යසනය",   # disaster
    # Tamil — floods / disasters / urgent
    "வெள்ளம்",     # flood
    "நிலச்சரிவு",  # landslide
    "சுழற்காற்று", # cyclone
    "நிலநடுக்கம்", # earthquake
    "அவசர",       # urgent
    "உதவி தேவை",  # help needed
    "சிக்கிக்கொண்", # trapped
    "மீட்பு",      # rescue
    "பேரழிவு",     # disaster
    "பாதிக்கப்பட்", # affected
]


def apply_keyword_boost(text: str, label_id: int, confidence: float, probs_dict: dict) -> tuple[int, float, dict]:
    """
    If model predicts Neutral/Medium but strong high-emergency keywords are
    present, override classification to High (label_id = 1).
    Does NOT downgrade a genuine High prediction.
    """
    if label_id == 1:
        return label_id, confidence, probs_dict  # already High — no change

    matched = [kw for kw in HIGH_EMERGENCY_KEYWORDS if kw.lower() in text.lower()]
    if matched:
        logger.info(f"Keyword boost triggered by: {matched[:3]}")
        boosted_conf = max(0.85, confidence)
        new_probs = {"Neutral/Medium": round(1 - boosted_conf, 4), "High": round(boosted_conf, 4)}
        return 1, round(boosted_conf, 4), new_probs

    return label_id, confidence, probs_dict

# ─── Global model state ───────────────────────────────────────────────────────
model_state = {"tokenizer": None, "model": None, "device": None}


def load_model():
    """Load the XLM-RoBERTa model and tokenizer from local path."""
    model_path = Path(MODEL_PATH).resolve()
    logger.info(f"Loading model from: {model_path}")

    if not model_path.exists():
        raise FileNotFoundError(f"Model path does not exist: {model_path}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Using device: {device}")

    tokenizer = AutoTokenizer.from_pretrained(str(model_path))
    model = AutoModelForSequenceClassification.from_pretrained(str(model_path))
    model.to(device)
    model.eval()

    model_state["tokenizer"] = tokenizer
    model_state["model"] = model
    model_state["device"] = device

    logger.info("✅ Model loaded successfully!")
    logger.info(f"   Model type: {model.config.model_type}")
    logger.info(f"   Num labels: {model.config.num_labels}")
    logger.info(f"   Label 0 = Neutral/Medium  |  Label 1 = High  (confirmed)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, clean up on shutdown."""
    load_model()
    yield
    logger.info("Shutting down ML service...")


# ─── FastAPI App ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="Disaster ML Microservice",
    description=(
        "Classifies disaster-related text (Sinhala/Tamil/English) into High or Neutral/Medium emergency levels. "
        "Also provides sentiment analysis (Positive/Negative/Neutral). "
        "Label 0 = Neutral/Medium | Label 1 = High."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Schemas ──────────────────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    text: str

    class Config:
        json_schema_extra = {
            "example": {
                "text": "Major flood in Colombo, people need urgent help"
            }
        }


class PredictResponse(BaseModel):
    label: str
    label_id: int
    confidence: float
    probabilities: dict[str, float]
    text_length: int


class SentimentResponse(BaseModel):
    sentiment: str          # "Positive" | "Negative" | "Neutral"
    sentiment_score: float  # -1.0 (most negative) to +1.0 (most positive)
    positive_signals: int
    negative_signals: int
    text_length: int


class FullAnalysisResponse(BaseModel):
    """Combined emergency classification + sentiment in one call."""
    label: str
    label_id: int
    confidence: float
    probabilities: dict[str, float]
    sentiment: str
    sentiment_score: float
    text_length: int


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: str
    model_type: str
    version: str


# ─── Sentiment Analysis (rule-based, no extra model needed) ──────────────────
def analyze_sentiment_text(text: str) -> dict:
    """
    Rule-based multilingual sentiment analysis.
    Uses keyword matching for Sinhala, Tamil, and English.
    Returns: sentiment label, score (-1 to +1), signal counts.
    """
    text_lower = text.lower()

    pos_count = sum(1 for kw in POSITIVE_KEYWORDS if kw.lower() in text_lower)
    neg_count = sum(1 for kw in NEGATIVE_KEYWORDS if kw.lower() in text_lower)

    total = pos_count + neg_count
    if total == 0:
        score = 0.0
        sentiment = "Neutral"
    else:
        score = round((pos_count - neg_count) / total, 4)
        if score > 0.1:
            sentiment = "Positive"
        elif score < -0.1:
            sentiment = "Negative"
        else:
            sentiment = "Neutral"

    return {
        "sentiment": sentiment,
        "sentiment_score": score,
        "positive_signals": pos_count,
        "negative_signals": neg_count,
    }


# ─── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Check if the service and model are ready."""
    model = model_state["model"]
    device = model_state["device"]

    return HealthResponse(
        status="ok" if model is not None else "loading",
        model_loaded=model is not None,
        device=str(device) if device else "unknown",
        model_type=model.config.model_type if model else "unknown",
        version="2.0.0",
    )


@app.post("/predict", response_model=PredictResponse, tags=["Classification"])
async def predict(request: PredictRequest):
    """
    Classify text into emergency levels.

    - **High** (Label 1): Urgent disaster requiring immediate response
    - **Neutral/Medium** (Label 0): General or low-priority disaster mention

    Supports Sinhala (සිංහල), Tamil (தமிழ்), and English text.
    """
    tokenizer = model_state["tokenizer"]
    model = model_state["model"]
    device = model_state["device"]

    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model is not loaded yet. Please try again shortly.")

    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text cannot be empty.")

    if len(text) > 5000:
        raise HTTPException(status_code=422, detail="Text exceeds maximum length of 5000 characters.")

    try:
        inputs = tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits
            probabilities = torch.softmax(logits, dim=-1)[0]

        label_id = int(torch.argmax(probabilities).item())
        confidence = float(probabilities[label_id].item())
        label = ID2LABEL[label_id]

        probs_dict = {
            ID2LABEL[i]: float(probabilities[i].item())
            for i in range(len(probabilities))
        }

        logger.info(
            f"Prediction: '{text[:60]}...' → {label} (confidence: {confidence:.4f})"
            if len(text) > 60
            else f"Prediction: '{text}' → {label} (confidence: {confidence:.4f})"
        )

        # ── Keyword boost override ──────────────────────────────────────────
        label_id, confidence, probs_dict = apply_keyword_boost(
            text, label_id, confidence, probs_dict
        )
        label = ID2LABEL[label_id]

        return PredictResponse(
            label=label,
            label_id=label_id,
            confidence=round(confidence, 4),
            probabilities={k: round(v, 4) for k, v in probs_dict.items()},
            text_length=len(text),
        )

    except Exception as e:
        logger.error(f"Prediction error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.post("/sentiment", response_model=SentimentResponse, tags=["Sentiment Analysis"])
async def sentiment(request: PredictRequest):
    """
    Perform sentiment analysis on disaster-related text.

    Returns:
    - **Positive**: Rescue successful, aid arrived, situation improving
    - **Negative**: Deaths, injuries, people trapped, urgent help needed
    - **Neutral**: Factual reporting without strong emotional signals

    Supports Sinhala (සිංහල), Tamil (தமிழ்), and English text.
    Uses a multilingual keyword lexicon approach.
    """
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text cannot be empty.")

    result = analyze_sentiment_text(text)
    logger.info(f"Sentiment: '{text[:50]}' → {result['sentiment']} (score: {result['sentiment_score']})")

    return SentimentResponse(
        **result,
        text_length=len(text),
    )


@app.post("/analyze", response_model=FullAnalysisResponse, tags=["Full Analysis"])
async def analyze(request: PredictRequest):
    """
    Combined endpoint: Emergency Classification + Sentiment Analysis in one call.
    Reduces round-trips for the pipeline.

    Returns both:
    - Emergency level (High / Neutral/Medium) from XLM-RoBERTa
    - Sentiment (Positive / Negative / Neutral) from keyword analysis
    """
    # Run classification
    classification = await predict(request)

    # Run sentiment
    sentiment_result = analyze_sentiment_text(request.text.strip())

    return FullAnalysisResponse(
        label=classification.label,
        label_id=classification.label_id,
        confidence=classification.confidence,
        probabilities=classification.probabilities,
        sentiment=sentiment_result["sentiment"],
        sentiment_score=sentiment_result["sentiment_score"],
        text_length=classification.text_length,
    )


@app.post("/predict/batch", tags=["Classification"])
async def predict_batch(texts: list[str]):
    """
    Classify multiple texts in a single request (max 50).
    Returns a list of predictions in the same order.
    """
    if len(texts) > 50:
        raise HTTPException(status_code=422, detail="Maximum batch size is 50.")

    results = []
    for text in texts:
        try:
            result = await predict(PredictRequest(text=text))
            results.append(result)
        except HTTPException as e:
            results.append({"error": e.detail, "text": text})

    return results


@app.get("/", tags=["Root"])
async def root():
    return {
        "service": "Disaster ML Microservice",
        "version": "2.0.0",
        "label_mapping": {"0": "Neutral/Medium", "1": "High"},
        "endpoints": {
            "health": "GET /health",
            "predict": "POST /predict — Emergency level classification",
            "sentiment": "POST /sentiment — Sentiment analysis (Positive/Negative/Neutral)",
            "analyze": "POST /analyze — Combined classification + sentiment",
            "predict_batch": "POST /predict/batch — Batch classification (max 50)",
            "docs": "GET /docs",
        },
    }
