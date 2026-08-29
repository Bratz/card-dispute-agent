"""Demo ML model for Next Best Action — success probability per candidate action.

Honest label: this model is trained on SYNTHETIC dispute outcomes generated
below, so it demonstrates the pipeline (features -> training -> calibrated
probability -> auditable score), not intelligence learned from real cases. In
production the same features and the same tiny model retrain on the bank's real
won/lost outcomes, which the audit trail already records.

Pure-Python logistic regression: no numpy, no sklearn, no new dependencies.
Weights are stored in the app_config table; training is seeded and deterministic.
"""
import math, random
import service as S

FEATURES = ["b_request_evidence", "b_raise_chargeback", "b_submit_representment",
            "b_send_correspondence", "has_required", "contradiction_open",
            "merchant_conf", "cardholder_conf", "amount_norm", "days_left_norm"]

def _sigmoid(z):
    return 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))

def _vec(f):
    """Bias + raw features + interaction terms. The interactions let a linear
    model learn action-specific effects (e.g. a strong merchant position helps a
    representment but not a chargeback) while staying fully interpretable."""
    g = lambda k: float(f.get(k, 0.0))
    inter = [g("merchant_conf") * g("b_submit_representment"),
             g("cardholder_conf") * g("b_raise_chargeback"),
             g("contradiction_open") * g("b_submit_representment"),
             g("has_required") * g("b_submit_representment"),
             g("merchant_conf") * g("b_raise_chargeback")]
    return [1.0] + [g(k) for k in FEATURES] + inter

# ------------------------------------------------------------ synthetic outcomes
def _true_success_p(f):
    """The hidden 'world' the demo model learns from. Encodes plausible dispute
    behaviour: representments win when the merchant position is strong and there
    is no open contradiction; chargebacks win with the cardholder position;
    evidence requests usually get answered; everything degrades near deadlines."""
    z = -0.2
    if f["b_request_evidence"]:
        z += 1.0 + 0.5 * f["days_left_norm"]
    if f["b_raise_chargeback"]:
        z += 2.5 * f["cardholder_conf"] - 1.2 * f["merchant_conf"] - 0.4
    if f["b_submit_representment"]:
        z += 2.8 * f["merchant_conf"] - 1.5 * f["contradiction_open"] - 0.5
        z += 0.8 * f["has_required"] - 0.8
    if f["b_send_correspondence"]:
        z += 0.2
    return _sigmoid(z)

def generate_training_data(n=3000, seed=42):
    rng = random.Random(seed)
    rows = []
    for _ in range(n):
        action = rng.choice(["request_evidence", "raise_chargeback",
                             "submit_representment", "send_correspondence"])
        mc = rng.random()
        f = {"b_" + a: 1.0 if a == action else 0.0
             for a in ["request_evidence", "raise_chargeback", "submit_representment", "send_correspondence"]}
        f.update({"has_required": 1.0 if rng.random() < 0.6 else 0.0,
                  "contradiction_open": 1.0 if rng.random() < 0.4 else 0.0,
                  "merchant_conf": mc, "cardholder_conf": 1.0 - mc,
                  "amount_norm": rng.random(), "days_left_norm": rng.random()})
        rows.append((f, 1 if rng.random() < _true_success_p(f) else 0))
    return rows

# ------------------------------------------------------------ train / predict
def train(c, n=1500, seed=42, epochs=400, lr=1.0):
    rows = generate_training_data(n, seed)
    X = [_vec(f) for f, _ in rows]
    y = [float(o) for _, o in rows]
    w = [0.0] * len(X[0])
    m = float(len(X))
    for _ in range(epochs):
        grad = [0.0] * len(w)
        for xi, yi in zip(X, y):
            err = _sigmoid(sum(a * b for a, b in zip(w, xi))) - yi
            for j, xj in enumerate(xi):
                grad[j] += err * xj
        w = [wj - lr * gj / m for wj, gj in zip(w, grad)]
    acc = sum(1 for xi, yi in zip(X, y)
              if (_sigmoid(sum(a * b for a, b in zip(w, xi))) >= 0.5) == (yi == 1)) / m
    S._config_set(c, "nba_model", {"weights": w, "features": FEATURES,
                                   "trained_on": "synthetic outcomes (n=%d, seed=%d)" % (n, seed),
                                   "train_accuracy": round(acc, 3), "version": "demo-1"})
    return acc

def model_info(c):
    return S._config_get(c, "nba_model", None)

def predict(c, features):
    m = model_info(c)
    if not m:
        train(c)
        m = model_info(c)
    return _sigmoid(sum(a * b for a, b in zip(m["weights"], _vec(features))))
