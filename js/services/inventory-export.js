import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";

const INVENTORY_COLUMNS = [
    "Ingrediente",
    "Categoría",
    "Existencias",
    "Unidad",
    "Stock mínimo",
    "Precio unitario",
    "Valor total"
];
const CURRENCY_FORMAT = '"S/ " #,##0.00';
const QUANTITY_FORMAT = "#,##0.000";

function formatExportDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error("No se pudo determinar la fecha y hora de exportación.");
    }
    return new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(date);
}

function toNonnegativeNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`El valor de ${label} no es válido para exportar.`);
    }
    return number;
}

function safeSpreadsheetText(value) {
    const text = String(value ?? "");
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function buildInventoryAccountingReport(items, exportedAt = new Date()) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("No hay ingredientes para exportar.");
    }

    const rows = items.map((item) => {
        if (!item || !String(item.nombre || "").trim()) {
            throw new Error("Hay un ingrediente sin nombre válido.");
        }
        const quantity = toNonnegativeNumber(item.cantidad, `existencias de ${item.nombre}`);
        const minimum = toNonnegativeNumber(item.minimo, `stock mínimo de ${item.nombre}`);
        const unitPrice = toNonnegativeNumber(item.precio_unitario ?? 0, `precio de ${item.nombre}`);
        return {
            name: String(item.nombre).trim(),
            category: String(item.categoria || "General"),
            quantity,
            unit: String(item.unidad || "").trim(),
            minimum,
            unitPrice,
            totalValue: quantity * unitPrice
        };
    });

    return {
        exportedAt: formatExportDate(exportedAt),
        rows,
        totalValue: rows.reduce((total, row) => total + row.totalValue, 0)
    };
}

export function exportInventoryPdf(items) {
    const report = buildInventoryAccountingReport(items);
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    doc.setProperties({
        title: "FRYGOURMETT - Inventario",
        subject: "Valorización contable de inventario"
    });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(31, 41, 55);
    doc.text("FRYGOURMETT - Inventario valorizado", 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 98, 110);
    doc.text(`Exportado: ${report.exportedAt}`, 14, 22);

    autoTable(doc, {
        head: [INVENTORY_COLUMNS],
        body: report.rows.map((row) => [
            row.name,
            row.category,
            row.quantity.toFixed(3),
            row.unit,
            row.minimum.toFixed(3),
            `S/ ${row.unitPrice.toFixed(2)}`,
            `S/ ${row.totalValue.toFixed(2)}`
        ]),
        foot: [[
            "TOTAL VALORIZADO",
            "",
            "",
            "",
            "",
            "",
            `S/ ${report.totalValue.toFixed(2)}`
        ]],
        startY: 27,
        theme: "grid",
        margin: { left: 10, right: 10 },
        styles: {
            font: "helvetica",
            fontSize: 9,
            cellPadding: 2,
            overflow: "linebreak",
            valign: "middle"
        },
        headStyles: {
            fillColor: [31, 41, 55],
            textColor: [255, 255, 255],
            fontStyle: "bold"
        },
        alternateRowStyles: { fillColor: [243, 244, 246] },
        footStyles: {
            fillColor: [31, 41, 55],
            textColor: [255, 255, 255],
            fontStyle: "bold"
        },
        columnStyles: {
            0: { cellWidth: 52 },
            1: { cellWidth: 42 },
            2: { cellWidth: 27, halign: "right" },
            3: { cellWidth: 22 },
            4: { cellWidth: 27, halign: "right" },
            5: { cellWidth: 37, halign: "right" },
            6: { cellWidth: "auto", halign: "right" }
        }
    });

    doc.save(`frygourmett-inventario-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportInventoryExcel(items) {
    const report = buildInventoryAccountingReport(items);
    const headerRow = 3;
    const firstDataRow = headerRow + 1;
    const totalRow = firstDataRow + report.rows.length;
    const sheetRows = [
        ["FRYGOURMETT - Inventario valorizado"],
        [`Exportado: ${report.exportedAt}`],
        [],
        INVENTORY_COLUMNS,
        ...report.rows.map((row) => [
            safeSpreadsheetText(row.name),
            safeSpreadsheetText(row.category),
            row.quantity,
            safeSpreadsheetText(row.unit),
            row.minimum,
            row.unitPrice,
            row.totalValue
        ]),
        ["TOTAL VALORIZADO", "", "", "", "", "", report.totalValue]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    const lastDataRowNumber = firstDataRow + report.rows.length;

    worksheet["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: INVENTORY_COLUMNS.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: INVENTORY_COLUMNS.length - 1 } }
    ];
    worksheet["!cols"] = [
        { wch: 30 },
        { wch: 26 },
        { wch: 16 },
        { wch: 14 },
        { wch: 16 },
        { wch: 18 },
        { wch: 18 }
    ];
    worksheet["!autofilter"] = {
        ref: `A${headerRow + 1}:G${totalRow}`
    };

    worksheet.A1.s = {
        fill: { fgColor: { rgb: "1F2937" } },
        font: { name: "Arial", sz: 16, bold: true, color: { rgb: "FFFFFF" } },
        alignment: { vertical: "center" }
    };
    worksheet.A2.s = {
        font: { name: "Arial", sz: 10, italic: true, color: { rgb: "5B6472" } }
    };
    worksheet["!rows"] = [{ hpt: 28 }, { hpt: 20 }];

    for (let column = 0; column < INVENTORY_COLUMNS.length; column += 1) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: headerRow, c: column })];
        cell.s = {
            fill: { fgColor: { rgb: "1F2937" } },
            font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" } },
            alignment: {
                horizontal: [2, 4, 5, 6].includes(column) ? "right" : "left",
                vertical: "center"
            }
        };
    }

    for (let rowIndex = firstDataRow; rowIndex < totalRow; rowIndex += 1) {
        const alternate = (rowIndex - firstDataRow) % 2 === 0;
        for (let column = 0; column < INVENTORY_COLUMNS.length; column += 1) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })];
            if (!cell) continue;
            cell.s = {
                fill: { fgColor: { rgb: alternate ? "F3F4F6" : "FFFFFF" } },
                font: { name: "Arial", sz: 10, color: { rgb: "1F2937" } },
                alignment: {
                    horizontal: [2, 4, 5, 6].includes(column) ? "right" : "left",
                    vertical: "center"
                }
            };
            if ([2, 4].includes(column)) cell.z = QUANTITY_FORMAT;
            if ([5, 6].includes(column)) cell.z = CURRENCY_FORMAT;
        }
    }

    const totalCellStyle = {
        fill: { fgColor: { rgb: "1F2937" } },
        font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" } },
        alignment: { vertical: "center" }
    };
    for (let column = 0; column < INVENTORY_COLUMNS.length; column += 1) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: totalRow, c: column })];
        if (!cell) continue;
        cell.s = {
            ...totalCellStyle,
            alignment: {
                horizontal: [2, 4, 5, 6].includes(column) ? "right" : "left",
                vertical: "center"
            }
        };
    }

    const totalValueCell = worksheet[XLSX.utils.encode_cell({ r: totalRow, c: 6 })];
    totalValueCell.f = `SUM(G${firstDataRow + 1}:G${lastDataRowNumber})`;
    totalValueCell.z = CURRENCY_FORMAT;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
    XLSX.writeFile(workbook, `frygourmett-inventario-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
