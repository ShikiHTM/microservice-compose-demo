# Architecture — 2 Microservices, 2 Exposure Models

Project có hai business microservices: **Order** và **Catalog**. Mục tiêu là tách rõ service ownership, Docker network boundary và public exposure boundary.

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

# Case 1 — Nginx public, native backend private

Deployment: `compose.yaml`.

```text
                         INTERNET
                            |
                         HTTPS
                            |
                            v
                         ngrok
                            |
                         edge-net
                            |
                            v
                +-----------------------+
                | Frontend + Nginx      |
                | selected reverse proxy|
                +-----------+-----------+
                            |
                       service-net
                    /               \
                   v                 v
            order-service -----> catalog-service
                 |                    |
          order-data-net       catalog-data-net
                 |                    |
             PostgreSQL              Redis
```

Ngrok chỉ có đường tới `frontend-service`. Order/Catalog không có public endpoint riêng và không publish host port.

Nginx serve React và reverse proxy **chỉ các route được chọn**:

```text
GET  /shop/products  -> catalog-service:8002/products
GET  /shop/orders    -> order-service:8003/orders
POST /shop/checkout  -> order-service:8003/orders
```

Các route metadata `/shop/system/...` cũng được proxy riêng cho UI. Không có generic `/api/*` proxy:

```text
/api/order/*    -> 404
/api/catalog/*  -> 404
```

External client vẫn có thể gọi `/shop/checkout` vì đó là public frontend route. Case 1 bảo vệ **native microservice interface và direct service exposure**, không phải phân biệt browser với Postman.

---

# Case 2 — ba public URL độc lập từ một ngrok agent

Deployment: `compose.public.yaml`.

Case 2 không dùng shared Nginx Gateway. Một ngrok agent mở ba tunnel trong cùng một agent session:

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

Tunnel definitions nằm trong `ngrok/ngrok.yml`:

```text
frontend -> frontend-service:80
order    -> order-service:8003
catalog  -> catalog-service:8002
```

Mỗi public component có URL riêng:

```text
https://<frontend>.ngrok-free.app/
https://<order>.ngrok-free.app/orders
https://<catalog>.ngrok-free.app/products
```

Browser tải React từ frontend tunnel, discover runtime URL của Order/Catalog qua ngrok inspector metadata, rồi gọi trực tiếp hai backend tunnel.

```text
Browser -> FE public URL      -> frontend-service
Browser -> Order public URL   -> order-service
Browser -> Catalog public URL -> catalog-service
```

Frontend Nginx trong Case 2 **không reverse proxy business API**. Nó chỉ serve React và expose runtime tunnel metadata.

Do các origin khác nhau, Order và Catalog bật CORS cho demo. Đây là browser interoperability, không phải security boundary.

Internal microservice call vẫn giữ private:

```text
order-service -> service-net -> catalog-service:8002
```

Order không đi vòng ra Internet/ngrok để reserve stock.

---

# So sánh exposure boundary

```text
CASE 1
Internet -> ngrok -> Frontend/Nginx -> selected /shop routes -> private backend

CASE 2
Internet -> FE tunnel      -> Frontend
Internet -> Order tunnel   -> Order API
Internet -> Catalog tunnel -> Catalog API
```

| | Case 1 | Case 2 |
|---|---|---|
| Frontend public | ✅ | ✅ |
| Nginx reverse proxy business API | ✅, selected `/shop/*` | ❌ |
| Order có public URL riêng | ❌ | ✅ |
| Catalog có public URL riêng | ❌ | ✅ |
| Host publish 8002/8003 | ❌ | ❌ |
| Database public | ❌ | ❌ |
| Order -> Catalog nội bộ | ✅ | ✅ |
| Ngrok agent sessions cho deployment | 1 | 1 |

Điểm khác biệt chính là **backend có public endpoint riêng hay không**.

---

# Ngrok và Docker ports

`EXPOSE` hoặc container port không tự public ra host.

```text
8002/tcp
```

trong `docker compose ps` không tương đương:

```text
0.0.0.0:8002->8002/tcp
```

Case 2 chứng minh một service vẫn có thể public Internet qua ngrok dù không publish host port.

---

# Persistence

- PostgreSQL -> named volume `order-data`.
- Redis -> AOF + named volume `catalog-data`.
- `docker compose down` giữ volumes.
- `docker compose down -v` xóa volumes.
- Ngrok URLs có thể thay đổi khi tunnel được tạo lại.

# Dependency graph

```text
Redis healthy ------> Catalog healthy ----+
                                          |
Postgres healthy ------------------------> Order healthy
                                          |
Catalog healthy --------------------------+
```

Case 1:

```text
Order + Catalog healthy -> Frontend/Nginx healthy -> ngrok starts
```

Case 2:

```text
Frontend + Order + Catalog healthy -> one ngrok agent -> 3 tunnels
```

# Boundary proof

Order thấy Catalog:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
```

Order không thấy Redis:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"
```

Catalog không thấy PostgreSQL:

```powershell
docker compose -f compose.public.yaml exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"
```
