package utils

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
	"time"
)

// Claims 包含登入者資訊
type Claims struct {
	EmpNo  string `json:"empno"`
	EmpNm  string `json:"empnm"`
	CompID string `json:"compid,omitempty"`
	DepNo  string `json:"depno,omitempty"`
	Exp    int64  `json:"exp"`
}

var (
	jwtSecret     []byte
	jwtSecretOnce sync.Once
)

func getSecret() []byte {
	jwtSecretOnce.Do(func() {
		secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
		if secret == "" {
			log.Fatal("JWT_SECRET is required")
		}
		jwtSecret = []byte(secret)
	})
	return jwtSecret
}

// GenerateToken 產生 HMAC-SHA256 簽章的 JWT
func GenerateToken(empNo, empNm, compID, depNo string, ttl time.Duration) (string, time.Time, error) {
	header := map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	}

	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", time.Time{}, err
	}

	exp := time.Now().Add(ttl)
	claims := Claims{
		EmpNo:  empNo,
		EmpNm:  empNm,
		CompID: compID,
		DepNo:  depNo,
		Exp:    exp.Unix(),
	}

	payloadJSON, err := json.Marshal(claims)
	if err != nil {
		return "", time.Time{}, err
	}

	headerEnc := base64.RawURLEncoding.EncodeToString(headerJSON)
	payloadEnc := base64.RawURLEncoding.EncodeToString(payloadJSON)
	unsigned := headerEnc + "." + payloadEnc

	signature := sign(unsigned, getSecret())
	token := unsigned + "." + signature

	return token, exp, nil
}

// ValidateToken 驗證 JWT 簽章與過期時間
func ValidateToken(token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("token format invalid")
	}

	unsigned := parts[0] + "." + parts[1]
	expectedSig := sign(unsigned, getSecret())

	providedSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("token signature decode failed")
	}
	expectedSigBytes, err := base64.RawURLEncoding.DecodeString(expectedSig)
	if err != nil {
		return nil, errors.New("token signature compute failed")
	}
	if !hmac.Equal(providedSig, expectedSigBytes) {
		return nil, errors.New("token signature mismatch")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("token payload decode failed")
	}

	var claims Claims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, errors.New("token payload invalid")
	}

	if claims.Exp < time.Now().Unix() {
		return nil, errors.New("token expired")
	}

	return &claims, nil
}

func sign(data string, secret []byte) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(data))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
