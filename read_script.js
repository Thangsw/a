const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('c:/Automation Ex/11testAuto/database.sqlite');

db.get("SELECT full_script_text FROM script_finals ORDER BY id DESC LIMIT 1;", (err, row) => {
    if (err) {
        console.error("Lỗi đọc DB:", err.message);
    } else if (row) {
        console.log("KỊCH BẢN TÌM THẤY:");
        console.log("--------------------");
        console.log(row.full_script_text.substring(0, 1000) + "...");
        console.log("--------------------");
        console.log("Độ dài tổng cộng: " + row.full_script_text.split(/\s+/).length + " từ.");
    } else {
        console.log("Không tìm thấy kịch bản nào.");
    }
    db.close();
});
