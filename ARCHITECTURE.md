# Architecture — 2 Microservices, 2 Exposure Models

Project có hai business microservices: **Order** và **Catalog**.

## Business ownership

```text
Order Service                          Catalog Service
- create/list orders                   - list products
- customer snapshot                    - price + stock
- persist order                        - reserve stock
       |                                      |
       v                                      v
   PostgreSQL                               Redis
```

Order gọi Catalog bằng REST. Order không đọc Redis trực tiếp; Catalog không đọc PostgreSQL trực tiếp.

## Network model chung

```text
                     service-net
             +-----------------------+
             |                       |
             v                       v
       order-service ----------> catalog-service
             |                       |
      order-data-net          catalog-data-net
             |                       |
             v                       v
          postgres                  redis
```

| Component | service-net | order-data-net | catalog-data-net |
|---|:---:|:---:|:---:|
| Order | ✅ | ✅ | ❌ |
| Catalog | ✅ | ❌ | ✅ |
| PostgreSQL | ❌ | ✅ | ❌ |
| Redis | ❌ | ❌ | ✅ |

---

# Case 1 — ngrok làm reverse proxy, backend native không public riêng

Deployment: `compose.yaml`.

```text
                              INTERNET
                                 |
                              HTTPS
                                 |
                                 v
                    +--------------------------+
                    | ngrok public endpoint    |
                    | Traffic Policy / routing |
                    +------------+-------------+
                                 |
               +-----------------+------------------+
               |                 |                  |
               v                 v                  v
          / -> frontend      /shop/order      /shop/catalog
               |                 |                  |
          edge-net          forward-internal   forward-internal
                                 |                  |
                                 v                  v
                         order-service -----> catalog-service
                              |                    |
                       order-data-net       catalog-data-net
                              |                    |
                          PostgreSQL              Redis
```

Case 1 không dùng BFF. Nginx chỉ serve React static files và **không reverse proxy backend**.

`ngrok/ngrok.private.yml` dùng agent config v3 với ba endpoint:

```text
public              random HTTPS public endpoint
order.internal      internal endpoint -> order-service:8003
catalog.internal    internal endpoint -> catalog-service:8002
```

`.internal` được ngrok hiểu là internal binding, vì vậy Order/Catalog không có public URL riêng.

Public endpoint dùng Traffic Policy để route có chọn lọc:

```text
/                          -> frontend-service:80 (public endpoint upstream)
/shop/products             -> rewrite /products -> catalog.internal
/shop/orders               -> rewrite /orders   -> order.internal
/shop/checkout             -> rewrite /orders   -> order.internal
/shop/system/order/*       -> rewrite prefix    -> order.internal
/shop/system/catalog/*     -> rewrite prefix    -> catalog.internal
/api/*                     -> custom 404 at ngrok edge
```

`url-rewrite` giữ public URL mà client nhìn thấy, còn `forward-internal` chuyển request tới internal endpoint.

### Network membership Case 1

| Component | edge-net | service-net |
|---|:---:|:---:|
| frontend-service | ✅ | ❌ |
| ngrok | ✅ | ✅ |
| order-service | ❌ | ✅ |
| catalog-service | ❌ | ✅ |

Điểm này rất quan trọng: **frontend Nginx không còn route tới backend**. Chính ngrok agent là thành phần nối public edge với private `service-net`.

External client vẫn gọi được selected public routes như `/shop/checkout`; Case 1 bảo vệ native interface/public endpoint riêng của microservice, không phân biệt browser và Postman.

---

# Case 2 — ba public URL độc lập từ một ngrok agent

Deployment: `compose.public.yaml`.

```text
                         INTERNET
            +---------------+---------------+
            |               |               |
            v               v               v
       FE public URL    Order public URL  Catalog public URL
            |               |               |
            +---------------+---------------+
                            |
                    one ngrok agent
                            |
             +--------------+--------------+
             |              |              |
             v              v              v
         frontend      order-service   catalog-service
                           |                |
                    order-data-net   catalog-data-net
                           |                |
                       PostgreSQL          Redis
```

`ngrok/ngrok.yml` tạo ba tunnel:

```text
frontend -> frontend-service:80
order    -> order-service:8003
catalog  -> catalog-service:8002
```

Order và Catalog có **public URL riêng**, nên browser/Postman có thể gọi native API trực tiếp.

Frontend Nginx Case 2 chỉ serve React và expose `/runtime/tunnels` để React discover backend URL. Business API không reverse proxy qua frontend.

Internal service-to-service vẫn là:

```text
order-service -> service-net -> catalog-service:8002
```

---

# So sánh exposure boundary

| | Case 1 | Case 2 |
|---|---|---|
| Frontend public | ✅ | ✅ |
| Reverse proxy business routing | ngrok Traffic Policy | Không shared reverse proxy |
| Order có public URL riêng | ❌ | ✅ |
| Catalog có public URL riêng | ❌ | ✅ |
| `/api/*` qua FE/public entry | ❌ 404 | Không dùng shared path |
| Host publish 8002/8003 | ❌ | ❌ |
| Database public | ❌ | ❌ |
| Order -> Catalog nội bộ | ✅ | ✅ |

```text
CASE 1
one public URL
  /                -> FE
  selected /shop/* -> private internal endpoints

CASE 2
FE_URL       -> FE
ORDER_URL    -> Order
CATALOG_URL  -> Catalog
```

---

# Ngrok concepts dùng trong bài

Case 1 dùng **Agent Config v3**, **Traffic Policy**, **URL Rewrite**, **Forward Internal**, **Internal Endpoints** và một random public HTTPS endpoint.

Case 2 dùng một ngrok agent chạy nhiều tunnel trong cùng session.

Không case nào cần publish host port `8002/8003`.

# Persistence

- PostgreSQL -> named volume `order-data`.
- Redis -> AOF + named volume `catalog-data`.
- `docker compose down` giữ volumes.
- `docker compose down -v` xóa volumes.

# Boundary proof

```powershell
# Order thấy Catalog
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"

# Order không thấy Redis
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"

# Catalog không thấy PostgreSQL
docker compose exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"

# Frontend Case 1 không còn ở service-net, nên không thấy Catalog
docker compose exec frontend-service wget -T 3 -O - http://catalog-service:8002/products
```
